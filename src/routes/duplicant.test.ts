import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
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

describe("duplicant routes", () => {
  let testDb: TestDatabase;

  const DEFAULT_STATS = {
    stamina: 100,
    calories: 4000,
    bladder: 0,
  } as const;

  const buildRoutes = (
    overrides?: (base: TestDatabase["db"]) => Record<string, unknown>,
  ) => {
    if (!overrides) {
      return createDuplicantRoutes(testDb.db);
    }
    const base = testDb.db;
    const proxy = Object.create(base);
    Object.assign(proxy, overrides(base));
    return createDuplicantRoutes(proxy as never);
  };

  const insertStats = async () => {
    const [statsRow] = await testDb.db.insert(stats).values(DEFAULT_STATS).returning();
    return statsRow!;
  };

  const insertDuplicant = async (
    values: Partial<typeof duplicant.$inferInsert> = {},
  ) => {
    const statsRow = await insertStats();
    const [dup] = await testDb.db
      .insert(duplicant)
      .values({
        name: "Ada",
        taskId: DEFAULT_IDLE_TASK_ID,
        scheduleId: DEFAULT_SCHEDULE_ID,
        statsId: statsRow.id,
        ...values,
      })
      .returning();

    await testDb.db
      .update(stats)
      .set({ duplicantId: dup!.id })
      .where(eq(stats.id, statsRow.id));

    return dup!;
  };

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
    const statsRow = await insertStats();

    const [created] = await testDb.db
      .insert(duplicant)
      .values({
        name: "Ada",
        taskId: DEFAULT_IDLE_TASK_ID,
        scheduleId: DEFAULT_SCHEDULE_ID,
        statsId: statsRow.id,
      })
      .returning();

    await testDb.db
      .update(stats)
      .set({ duplicantId: created!.id })
      .where(eq(stats.id, statsRow.id));

    const routes = buildRoutes();
    const res = await routes.request("/");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      id: created!.id,
      name: "Ada",
      taskId: DEFAULT_IDLE_TASK_ID,
      scheduleId: DEFAULT_SCHEDULE_ID,
    });
  });

  it("fetches a duplicant by id", async () => {
    const dup = await insertDuplicant();

    const routes = buildRoutes();
    const res = await routes.request(`/${dup.id}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: dup.id, name: dup.name });
  });

  it("returns 404 when a duplicant is missing", async () => {
    const routes = buildRoutes();
    const res = await routes.request("/missing");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Duplicant not found" });
  });

  it("validates alias mismatches when creating", async () => {
    const routes = buildRoutes();
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({
        name: "Ada",
        taskId: "idle",
        task: "builder",
        schedule: DEFAULT_SCHEDULE_ID,
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Invalid duplicant payload" });
  });

  it("validates schedule alias mismatches", async () => {
    const routes = buildRoutes();
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({
        name: "Ada",
        task: DEFAULT_IDLE_TASK_ID,
        scheduleId: "sched-a",
        schedule: "sched-b",
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Invalid duplicant payload" });
  });

  it("requires at least one field when updating", async () => {
    const dup = await insertDuplicant();

    const routes = buildRoutes();
    const res = await routes.request(`/${dup.id}`, {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Invalid duplicant payload" });
  });

  it("creates a duplicant using a transaction when available", async () => {
    const routes = buildRoutes();
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({ name: "Ada" }),
      headers: { "Content-Type": "application/json" },
    });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toMatchObject({
      name: "Ada",
      taskId: DEFAULT_IDLE_TASK_ID,
      scheduleId: DEFAULT_SCHEDULE_ID,
    });

    const linkedStats = await testDb.db.query.stats.findFirst({
      where: (tbl, { eq }) => eq(tbl.duplicantId, body.id),
    });
    expect(linkedStats).not.toBeNull();
  });

  it("creates a duplicant with an explicit id when transactions are available", async () => {
    const routes = buildRoutes();
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({ id: "dup-custom", name: "Ada" }),
      headers: { "Content-Type": "application/json" },
    });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.id).toBe("dup-custom");
  });

  it("creates a duplicant when transactions are unavailable", async () => {
    const routes = buildRoutes(() => ({ transaction: undefined }));

    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({ id: "dup-no-tx", name: "Ada" }),
      headers: { "Content-Type": "application/json" },
    });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toMatchObject({
      id: "dup-no-tx",
      name: "Ada",
      taskId: DEFAULT_IDLE_TASK_ID,
    });

    const linkedStats = await testDb.db.query.stats.findFirst({
      where: (tbl, { eq }) => eq(tbl.duplicantId, "dup-no-tx"),
    });
    expect(linkedStats).not.toBeNull();
  });

  it("creates a duplicant without an id when transactions are unavailable", async () => {
    const routes = buildRoutes(() => ({ transaction: undefined }));

    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({ name: "No Id" }),
      headers: { "Content-Type": "application/json" },
    });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(typeof body.id).toBe("string");
  });

  it("defaults alias ids when create payload uses null identifiers", async () => {
    const routes = buildRoutes();
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({ name: "Ada", taskId: null, scheduleId: null }),
      headers: { "Content-Type": "application/json" },
    });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.taskId).toBe(DEFAULT_IDLE_TASK_ID);
    expect(body.scheduleId).toBe(DEFAULT_SCHEDULE_ID);
  });

  it("defaults alias values when alias fields are null", async () => {
    const routes = buildRoutes();
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({ name: "Ada", task: null, schedule: null }),
      headers: { "Content-Type": "application/json" },
    });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.taskId).toBe(DEFAULT_IDLE_TASK_ID);
    expect(body.scheduleId).toBe(DEFAULT_SCHEDULE_ID);
  });

  it("rejects invalid duplicant payloads", async () => {
    const routes = buildRoutes();
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Invalid duplicant payload" });
  });

  it("updates a duplicant", async () => {
    const dup = await insertDuplicant({ name: "Ada" });

    await testDb.db.insert(task).values({
      id: "task-farm",
      description: "Farm",
      skillId: "agriculture",
      targetId: null,
    });

    const routes = buildRoutes();
    const res = await routes.request(`/${dup.id}`, {
      method: "POST",
      body: JSON.stringify({ name: "Farmer Ada", task: "task-farm" }),
      headers: { "Content-Type": "application/json" },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe("Farmer Ada");
    expect(body.taskId).toBe("task-farm");
  });

  it("defaults schedule when updating with null alias", async () => {
    const dup = await insertDuplicant({ scheduleId: "custom" });

    const routes = buildRoutes();
    const res = await routes.request(`/${dup.id}`, {
      method: "POST",
      body: JSON.stringify({ schedule: null }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scheduleId).toBe(DEFAULT_SCHEDULE_ID);
  });

  it("defaults task when updating with null alias", async () => {
    const dup = await insertDuplicant({ taskId: "task-build" });

    const routes = buildRoutes();
    const res = await routes.request(`/${dup.id}`, {
      method: "POST",
      body: JSON.stringify({ task: null }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.taskId).toBe(DEFAULT_IDLE_TASK_ID);
  });

  it("updates schedule when scheduleId is provided", async () => {
    const dup = await insertDuplicant();

    await testDb.db.insert(schedule).values({
      id: "sched-night",
      activities: DEFAULT_SCHEDULE_ACTIVITIES,
    });

    const routes = buildRoutes();
    const res = await routes.request(`/${dup.id}`, {
      method: "POST",
      body: JSON.stringify({ scheduleId: "sched-night" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scheduleId).toBe("sched-night");
  });

  it("updates task when taskId is provided", async () => {
    const dup = await insertDuplicant();

    await testDb.db.insert(task).values({
      id: "task-special",
      description: "Special",
      skillId: "spec",
      targetId: null,
    });

    const routes = buildRoutes();
    const res = await routes.request(`/${dup.id}`, {
      method: "POST",
      body: JSON.stringify({ taskId: "task-special" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.taskId).toBe("task-special");
  });

  it("returns 404 when updating a missing duplicant", async () => {
    const routes = buildRoutes();
    const res = await routes.request("/missing", {
      method: "POST",
      body: JSON.stringify({ name: "Ghost" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Duplicant not found" });
  });

  it("deletes a duplicant", async () => {
    const dup = await insertDuplicant();

    const routes = buildRoutes();
    const res = await routes.request(`/${dup.id}`, { method: "DELETE" });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: dup.id });

    const remaining = await testDb.db.query.duplicant.findMany();
    expect(remaining).toHaveLength(0);
  });

  it("returns 404 when deleting a missing duplicant", async () => {
    const routes = buildRoutes();
    const res = await routes.request("/missing", { method: "DELETE" });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Duplicant not found" });
  });
});
