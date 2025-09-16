import { describe, it, expect, vi } from "vitest";

import { createDuplicantRoutes } from "./duplicant.js";

type MockDb = {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  transaction?: ReturnType<typeof vi.fn>;
};

function createMockDb(overrides: Partial<MockDb> = {}): MockDb {
  return {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    ...overrides,
  };
}

describe("duplicant routes", () => {
  it("lists all duplicants", async () => {
    const database = createMockDb();
    const duplicants = [
      {
        id: "dup-1",
        name: "Ada",
        taskId: "idle",
        scheduleId: "default",
        statsId: "stats-1",
      },
    ];
    const from = vi.fn().mockResolvedValue(duplicants);
    database.select.mockReturnValueOnce({ from });

    const routes = createDuplicantRoutes(database as never);
    const res = await routes.request("/");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(duplicants);
    expect(database.select).toHaveBeenCalledTimes(1);
  });

  it("fetches a duplicant by id", async () => {
    const database = createMockDb();
    const duplicant = {
      id: "dup-2",
      name: "Mina",
      taskId: "build",
      scheduleId: "night",
      statsId: "stats-2",
    };
    const where = vi.fn().mockResolvedValue([duplicant]);
    const from = vi.fn().mockReturnValue({ where });
    database.select.mockReturnValueOnce({ from });

    const routes = createDuplicantRoutes(database as never);
    const res = await routes.request(`/${duplicant.id}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(duplicant);
    expect(where).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when a duplicant is missing", async () => {
    const database = createMockDb();
    const where = vi.fn().mockResolvedValue([]);
    const from = vi.fn().mockReturnValue({ where });
    database.select.mockReturnValueOnce({ from });

    const routes = createDuplicantRoutes(database as never);
    const res = await routes.request("/missing");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Duplicant not found" });
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
      name: "Ada Updated",
      taskId: "task-99",
      scheduleId: "default",
      statsId: "stats-1",
    };
    const returning = vi.fn().mockResolvedValue([updated]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    database.update.mockReturnValueOnce({ set });

    const routes = createDuplicantRoutes(database as never);
    const res = await routes.request(`/dup-1`, {
      method: "POST",
      body: JSON.stringify({ name: "Ada Updated", task: "task-99" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(updated);
    expect(set).toHaveBeenCalledWith({ name: "Ada Updated", task: "task-99" });
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
      body: JSON.stringify({ name: "Nobody" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Duplicant not found" });
  });

  it("deletes a duplicant", async () => {
    const database = createMockDb();
    const deleted = {
      id: "dup-1",
      name: "Ada",
      taskId: "idle",
      scheduleId: "default",
      statsId: "stats-1",
    };
    const returning = vi.fn().mockResolvedValue([deleted]);
    const where = vi.fn().mockReturnValue({ returning });
    database.delete.mockReturnValueOnce({ where });

    const routes = createDuplicantRoutes(database as never);
    const res = await routes.request(`/dup-1`, { method: "DELETE" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(deleted);
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
