import { describe, it, expect, vi } from "vitest";

import { createDuplicantRoutes } from "./duplicant.js";

type MockDb = {
  query: {
    duplicant: {
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
    };
  };
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  transaction?: ReturnType<typeof vi.fn>;
};

function createMockDb(overrides: Partial<MockDb> = {}): MockDb {
  return {
    query: {
      duplicant: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
    },
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    ...overrides,
  };
}

describe("duplicant routes (unit)", () => {
  it("lists all duplicants", async () => {
    const database = createMockDb();
    const duplicants = [
      {
        id: "dup-1",
        name: "Ada",
        taskId: "idle",
        scheduleId: "default",
        statsId: "stats-1",
        schedule: { id: "default" },
        task: { id: "idle" },
        stats: { id: "stats-1" },
      },
    ];
    database.query.duplicant.findMany.mockResolvedValueOnce(duplicants);

    const routes = createDuplicantRoutes(database as never);
    const res = await routes.request("/");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(duplicants);
    expect(database.query.duplicant.findMany).toHaveBeenCalledWith({
      with: { schedule: true, task: true, stats: true },
    });
  });

  it("fetches a duplicant by id", async () => {
    const database = createMockDb();
    const duplicant = {
      id: "dup-2",
      name: "Mina",
      taskId: "build",
      scheduleId: "night",
      statsId: "stats-2",
      schedule: { id: "night" },
      task: { id: "build" },
      stats: { id: "stats-2" },
    };
    database.query.duplicant.findFirst.mockResolvedValueOnce(duplicant);

    const routes = createDuplicantRoutes(database as never);
    const res = await routes.request(`/${duplicant.id}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(duplicant);
    expect(database.query.duplicant.findFirst).toHaveBeenCalledTimes(1);
    const call = database.query.duplicant.findFirst.mock.calls[0]?.[0];
    expect(call?.with).toEqual({ schedule: true, task: true, stats: true });
  });

  it("returns 404 when a duplicant is missing", async () => {
    const database = createMockDb();
    database.query.duplicant.findFirst.mockResolvedValueOnce(undefined);

    const routes = createDuplicantRoutes(database as never);
    const res = await routes.request("/missing");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Duplicant not found" });
  });

  it("validates alias mismatches when creating", async () => {
    const database = createMockDb();
    const routes = createDuplicantRoutes(database as never);
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({
        name: "Ada",
        taskId: "a",
        task: "b",
        schedule: "default",
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Invalid duplicant payload" });
  });

  it("validates schedule alias mismatches", async () => {
    const database = createMockDb();
    const routes = createDuplicantRoutes(database as never);
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({
        name: "Ada",
        task: "idle",
        scheduleId: "a",
        schedule: "b",
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Invalid duplicant payload" });
  });

  it("requires at least one field when updating", async () => {
    const database = createMockDb();
    const routes = createDuplicantRoutes(database as never);
    const res = await routes.request("/dup-1", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Invalid duplicant payload" });
  });

  it("creates a duplicant using a transaction when available", async () => {
    const insertStatsReturning = vi
      .fn()
      .mockResolvedValue([{ id: "stats-created" }]);
    const insertStatsValues = vi.fn().mockReturnValue({ returning: insertStatsReturning });

    const createdDuplicant = {
      id: "dup-created",
      name: "Ada",
      taskId: "idle",
      scheduleId: "default",
      statsId: "stats-created",
    };
    const insertDupReturning = vi.fn().mockResolvedValue([createdDuplicant]);
    const insertDupValues = vi.fn().mockReturnValue({ returning: insertDupReturning });

    const insertQueue = [
      { values: insertStatsValues },
      { values: insertDupValues },
    ];
    const txInsert = vi.fn(() => insertQueue.shift()!);

    const updateStatsWhere = vi.fn().mockResolvedValue(undefined);
    const updateStatsSet = vi.fn().mockReturnValue({ where: updateStatsWhere });
    const txUpdate = vi.fn().mockReturnValue({ set: updateStatsSet });

    const transaction = vi.fn(async (callback: (tx: any) => Promise<unknown>) =>
      callback({ insert: txInsert, update: txUpdate }),
    );

    const database = createMockDb({ transaction });

    const routes = createDuplicantRoutes(database as never);
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({ name: "Ada" }),
      headers: { "Content-Type": "application/json" },
    });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toEqual(createdDuplicant);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(insertStatsValues).toHaveBeenCalledWith({
      stamina: 100,
      calories: 4000,
      bladder: 0,
    });
    expect(insertDupValues).toHaveBeenCalledWith({
      name: "Ada",
      taskId: "idle",
      scheduleId: "default",
      statsId: "stats-created",
    });
    expect(updateStatsSet).toHaveBeenCalledWith({ duplicantId: "dup-created" });
    expect(updateStatsWhere).toHaveBeenCalledTimes(1);
  });

  it("creates a duplicant without a transaction fallback", async () => {
    const insertStatsReturning = vi
      .fn()
      .mockResolvedValue([{ id: "stats-fallback" }]);
    const insertStatsValues = vi.fn().mockReturnValue({ returning: insertStatsReturning });

    const createdDuplicant = {
      id: "dup-fallback",
      name: "Mina",
      taskId: "task-123",
      scheduleId: "sched-77",
      statsId: "stats-fallback",
    };
    const insertDupReturning = vi.fn().mockResolvedValue([createdDuplicant]);
    const insertDupValues = vi.fn().mockReturnValue({ returning: insertDupReturning });

    const insertQueue = [
      { values: insertStatsValues },
      { values: insertDupValues },
    ];
    const insert = vi.fn(() => insertQueue.shift()!);

    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    const update = vi.fn().mockReturnValue({ set: updateSet });

    const database = createMockDb({ insert, update });

    const routes = createDuplicantRoutes(database as never);
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({
        name: "Mina",
        task: "task-123",
        schedule: "sched-77",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toEqual(createdDuplicant);
    expect(insertStatsValues).toHaveBeenCalledWith({
      stamina: 100,
      calories: 4000,
      bladder: 0,
    });
    expect(insertDupValues).toHaveBeenCalledWith({
      name: "Mina",
      taskId: "task-123",
      scheduleId: "sched-77",
      statsId: "stats-fallback",
    });
    expect(updateSet).toHaveBeenCalledWith({ duplicantId: "dup-fallback" });
    expect(updateWhere).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid duplicant payloads", async () => {
    const database = createMockDb();
    const routes = createDuplicantRoutes(database as never);

    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "Invalid duplicant payload",
    });
    expect(database.insert).not.toHaveBeenCalled();
  });

  it("updates a duplicant", async () => {
    const database = createMockDb();
    const updated = {
      id: "dup-1",
      name: "Sprocket",
      taskId: "task-5",
      scheduleId: "sched-3",
    };
    const returning = vi.fn().mockResolvedValue([updated]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    database.update.mockReturnValueOnce({ set });

    const routes = createDuplicantRoutes(database as never);
    const res = await routes.request(`/dup-1`, {
      method: "POST",
      body: JSON.stringify({ name: "Sprocket" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(updated);
    expect(set).toHaveBeenCalledWith({ name: "Sprocket" });
  });

  it("defaults schedule when updating with null alias", async () => {
    const database = createMockDb();
    const returning = vi.fn().mockResolvedValue([
      {
        id: "dup-3",
        name: "Ada",
        taskId: "idle",
        scheduleId: "default",
      },
    ]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    database.update.mockReturnValueOnce({ set });

    const routes = createDuplicantRoutes(database as never);
    const res = await routes.request("/dup-3", {
      method: "POST",
      body: JSON.stringify({ schedule: null }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(set).toHaveBeenCalledWith({ scheduleId: "default" });
  });

  it("returns 404 when updating a missing duplicant", async () => {
    const database = createMockDb();
    const returning = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    database.update.mockReturnValueOnce({ set });

    const routes = createDuplicantRoutes(database as never);
    const res = await routes.request(`/missing`, {
      method: "POST",
      body: JSON.stringify({ name: "Ghost" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Duplicant not found" });
  });

  it("deletes a duplicant", async () => {
    const database = createMockDb();
    const returning = vi.fn().mockResolvedValue([{ id: "dup-1" }]);
    const where = vi.fn().mockReturnValue({ returning });
    database.delete.mockReturnValueOnce({ where });

    const routes = createDuplicantRoutes(database as never);
    const res = await routes.request(`/dup-1`, { method: "DELETE" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "dup-1" });
  });

  it("returns 404 when deleting a missing duplicant", async () => {
    const database = createMockDb();
    const returning = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ returning });
    database.delete.mockReturnValueOnce({ where });

    const routes = createDuplicantRoutes(database as never);
    const res = await routes.request(`/missing`, { method: "DELETE" });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Duplicant not found" });
  });
});
