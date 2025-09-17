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
