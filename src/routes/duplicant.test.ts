import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { eq } from "drizzle-orm";

import { createDuplicantRoutes } from "./duplicant.js";
import {
  DEFAULT_IDLE_TASK_ID,
  DEFAULT_SCHEDULE_ACTIVITIES,
  DEFAULT_SCHEDULE_ID,
} from "../db/index.js";
import { createTestDatabase, type TestDatabase } from "../test-utils/db.js";
import { duplicant, schedule, stats, task } from "../db/schema.js";

describe("duplicant routes (integration)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  });

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(async () => {
    await testDb.reset();
    await testDb.db.insert(schedule).values({
      id: DEFAULT_SCHEDULE_ID,
      activities: DEFAULT_SCHEDULE_ACTIVITIES,
    });
    await testDb.db.insert(task).values({
      id: DEFAULT_IDLE_TASK_ID,
      description: "Idle",
      skillId: "idle",
      targetId: null,
    });
  });

  it("lists all duplicants", async () => {
    const [statsRow] = await testDb.db
      .insert(stats)
      .values({ stamina: 90, calories: 3500, bladder: 10 })
      .returning();

    await testDb.db.insert(duplicant).values({
      id: "dup-1",
      name: "Ada",
      taskId: DEFAULT_IDLE_TASK_ID,
      scheduleId: DEFAULT_SCHEDULE_ID,
      statsId: statsRow!.id,
    });

    await testDb.db
      .update(stats)
      .set({ duplicantId: "dup-1" })
      .where(eq(stats.id, statsRow!.id));

    const routes = createDuplicantRoutes(testDb.db);
    const res = await routes.request("/");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    const item = body[0];
    expect(item).toMatchObject({
      id: "dup-1",
      name: "Ada",
      taskId: DEFAULT_IDLE_TASK_ID,
      scheduleId: DEFAULT_SCHEDULE_ID,
      statsId: statsRow!.id,
    });
    expect(typeof item.createdAt).toBe("string");
    expect(item.schedule.id).toBe(DEFAULT_SCHEDULE_ID);
    expect(item.task.id).toBe(DEFAULT_IDLE_TASK_ID);
    expect(item.stats.id).toBe(statsRow!.id);
  });

  it("creates a duplicant with default task and schedule", async () => {
    const routes = createDuplicantRoutes(testDb.db);
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({ name: "Mina" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({
      name: "Mina",
      taskId: DEFAULT_IDLE_TASK_ID,
      scheduleId: DEFAULT_SCHEDULE_ID,
    });

    const dbDuplicant = await testDb.db.query.duplicant.findFirst({
      where: (tbl, { eq }) => eq(tbl.id, body.id),
      with: { stats: true },
    });
    expect(dbDuplicant?.statsId).toBeDefined();
    expect(dbDuplicant?.stats?.duplicantId).toBe(body.id);
  });

  it("honors alias fields for task and schedule", async () => {
    await testDb.db.insert(task).values({
      id: "task-build",
      description: "Build",
      skillId: "construct",
      targetId: null,
    });
    await testDb.db.insert(schedule).values({
      id: "sched-night",
      activities: [
        ...Array(8).fill("downtime"),
        ...Array(8).fill("work"),
        ...Array(8).fill("bedtime"),
      ],
    });

    const routes = createDuplicantRoutes(testDb.db);
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({
        name: "Nisbet",
        task: "task-build",
        schedule: "sched-night",
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.taskId).toBe("task-build");
    expect(body.scheduleId).toBe("sched-night");
  });

  it("rejects invalid duplicant payloads", async () => {
    const routes = createDuplicantRoutes(testDb.db);
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: "Invalid duplicant payload" });
  });

  it("updates an existing duplicant", async () => {
    const [statsRow] = await testDb.db
      .insert(stats)
      .values({ stamina: 80, calories: 3200, bladder: 20 })
      .returning();

    await testDb.db.insert(duplicant).values({
      id: "dup-2",
      name: "Meep",
      taskId: DEFAULT_IDLE_TASK_ID,
      scheduleId: DEFAULT_SCHEDULE_ID,
      statsId: statsRow!.id,
    });

    await testDb.db
      .update(stats)
      .set({ duplicantId: "dup-2" })
      .where(eq(stats.id, statsRow!.id));

    await testDb.db.insert(task).values({
      id: "task-farm",
      description: "Farm",
      skillId: "agriculture",
      targetId: null,
    });

    const routes = createDuplicantRoutes(testDb.db);
    const res = await routes.request("/dup-2", {
      method: "POST",
      body: JSON.stringify({
        name: "Farmer Meep",
        task: "task-farm",
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Farmer Meep");
    expect(body.taskId).toBe("task-farm");
  });

  it("returns 404 when updating a missing duplicant", async () => {
    const routes = createDuplicantRoutes(testDb.db);
    const res = await routes.request("/missing", {
      method: "POST",
      body: JSON.stringify({ name: "Ghost" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Duplicant not found" });
  });

  it("deletes a duplicant", async () => {
    const [statsRow] = await testDb.db
      .insert(stats)
      .values({ stamina: 70, calories: 2800, bladder: 30 })
      .returning();

    await testDb.db.insert(duplicant).values({
      id: "dup-del",
      name: "Breaker",
      taskId: DEFAULT_IDLE_TASK_ID,
      scheduleId: DEFAULT_SCHEDULE_ID,
      statsId: statsRow!.id,
    });

    await testDb.db
      .update(stats)
      .set({ duplicantId: "dup-del" })
      .where(eq(stats.id, statsRow!.id));

    const routes = createDuplicantRoutes(testDb.db);
    const res = await routes.request("/dup-del", { method: "DELETE" });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "dup-del" });

    const remaining = await testDb.db.query.duplicant.findMany();
    expect(remaining).toHaveLength(0);
  });

  it("returns 404 when deleting a missing duplicant", async () => {
    const routes = createDuplicantRoutes(testDb.db);
    const res = await routes.request("/missing", { method: "DELETE" });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Duplicant not found" });
  });
});

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
    const eqSpy = vi.fn();
    call?.where?.({ id: "table" } as never, { eq: eqSpy } as never);
    expect(eqSpy).toHaveBeenCalledWith("table", duplicant.id);
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
      id: "dup-request",
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
      body: JSON.stringify({ name: "Ada", id: "dup-request" }),
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
      id: "dup-request",
    });
    expect(updateStatsSet).toHaveBeenCalledWith({ duplicantId: "dup-request" });
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

  it("creates a duplicant with an explicit id when transactions are unavailable", async () => {
    const insertStatsReturning = vi
      .fn()
      .mockResolvedValue([{ id: "stats-fallback-id" }]);
    const insertStatsValues = vi.fn().mockReturnValue({ returning: insertStatsReturning });

    const createdDuplicant = {
      id: "dup-fallback-id",
      name: "Mina",
      taskId: "task-123",
      scheduleId: "sched-77",
      statsId: "stats-fallback-id",
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
        id: "dup-fallback-id",
        name: "Mina",
        taskId: "task-123",
        scheduleId: "sched-77",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toEqual(createdDuplicant);
    expect(insertDupValues).toHaveBeenCalledWith({
      name: "Mina",
      taskId: "task-123",
      scheduleId: "sched-77",
      statsId: "stats-fallback-id",
      id: "dup-fallback-id",
    });
  });

  it("defaults alias ids when create payload uses null identifiers", async () => {
    const insertStatsReturning = vi
      .fn()
      .mockResolvedValue([{ id: "stats-null" }]);
    const insertStatsValues = vi.fn().mockReturnValue({ returning: insertStatsReturning });

    const createdDuplicant = {
      id: "dup-null",
      name: "Ada",
      taskId: DEFAULT_IDLE_TASK_ID,
      scheduleId: DEFAULT_SCHEDULE_ID,
      statsId: "stats-null",
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
      body: JSON.stringify({ name: "Ada", taskId: null, scheduleId: null }),
      headers: { "Content-Type": "application/json" },
    });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.taskId).toBe(DEFAULT_IDLE_TASK_ID);
    expect(body.scheduleId).toBe(DEFAULT_SCHEDULE_ID);
    expect(insertDupValues).toHaveBeenCalledWith({
      name: "Ada",
      taskId: DEFAULT_IDLE_TASK_ID,
      scheduleId: DEFAULT_SCHEDULE_ID,
      statsId: "stats-null",
    });
  });

  it("defaults alias values when alias fields are null", async () => {
    const insertStatsReturning = vi
      .fn()
      .mockResolvedValue([{ id: "stats-alias-null" }]);
    const insertStatsValues = vi.fn().mockReturnValue({ returning: insertStatsReturning });

    const createdDuplicant = {
      id: "dup-alias-null",
      name: "Ada",
      taskId: DEFAULT_IDLE_TASK_ID,
      scheduleId: DEFAULT_SCHEDULE_ID,
      statsId: "stats-alias-null",
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
      body: JSON.stringify({ name: "Ada", task: null, schedule: null }),
      headers: { "Content-Type": "application/json" },
    });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.taskId).toBe(DEFAULT_IDLE_TASK_ID);
    expect(body.scheduleId).toBe(DEFAULT_SCHEDULE_ID);
    expect(insertDupValues).toHaveBeenCalledWith({
      name: "Ada",
      taskId: DEFAULT_IDLE_TASK_ID,
      scheduleId: DEFAULT_SCHEDULE_ID,
      statsId: "stats-alias-null",
    });
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

  it("defaults task when updating with null alias", async () => {
    const database = createMockDb();
    const returning = vi.fn().mockResolvedValue([
      {
        id: "dup-5",
        name: "Ada",
        taskId: "idle",
        scheduleId: "default",
      },
    ]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    database.update.mockReturnValueOnce({ set });

    const routes = createDuplicantRoutes(database as never);
    const res = await routes.request("/dup-5", {
      method: "POST",
      body: JSON.stringify({ task: null }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(set).toHaveBeenCalledWith({ taskId: "idle" });
  });

  it("updates schedule when scheduleId is provided", async () => {
    const database = createMockDb();
    const updated = {
      id: "dup-4",
      name: "Ada",
      taskId: "idle",
      scheduleId: "sched-night",
    };
    const returning = vi.fn().mockResolvedValue([updated]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    database.update.mockReturnValueOnce({ set });

    const routes = createDuplicantRoutes(database as never);
    const res = await routes.request("/dup-4", {
      method: "POST",
      body: JSON.stringify({ scheduleId: "sched-night" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(updated);
    expect(set).toHaveBeenCalledWith({ scheduleId: "sched-night" });
  });

  it("updates task when taskId is provided", async () => {
    const database = createMockDb();
    const updated = {
      id: "dup-6",
      name: "Ada",
      taskId: "task-special",
      scheduleId: "default",
    };
    const returning = vi.fn().mockResolvedValue([updated]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    database.update.mockReturnValueOnce({ set });

    const routes = createDuplicantRoutes(database as never);
    const res = await routes.request("/dup-6", {
      method: "POST",
      body: JSON.stringify({ taskId: "task-special" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(updated);
    expect(set).toHaveBeenCalledWith({ taskId: "task-special" });
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
