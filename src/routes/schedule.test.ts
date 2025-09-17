import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { createScheduleRoutes } from "./schedule.js";
import { createTestDatabase, type TestDatabase } from "../test-utils/db.js";
import { schedule } from "../db/schema.js";

describe("schedule routes (integration)", () => {
  let testDb: TestDatabase;

  const activities = Array(24).fill("work");

  beforeAll(async () => {
    testDb = await createTestDatabase();
  });

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(async () => {
    await testDb.reset();
  });

  it("lists all schedules", async () => {
    await testDb.db.insert(schedule).values({ id: "sched-1", activities });

    const routes = createScheduleRoutes(testDb.db);
    const res = await routes.request("/");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([
      {
        id: "sched-1",
        activities,
        duplicants: [],
      },
    ]);
  });

  it("fetches a schedule by id", async () => {
    await testDb.db.insert(schedule).values({ id: "sched-42", activities });

    const routes = createScheduleRoutes(testDb.db);
    const res = await routes.request("/sched-42");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      id: "sched-42",
      activities,
      duplicants: [],
    });
  });

  it("returns 404 when a schedule is missing", async () => {
    const routes = createScheduleRoutes(testDb.db);
    const res = await routes.request("/missing");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Schedule not found" });
  });

  it("creates a schedule from valid payload", async () => {
    const routes = createScheduleRoutes(testDb.db);
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({ activities }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.activities).toEqual(activities);
    expect(typeof body.id).toBe("string");
    expect(body.id.length).toBeGreaterThan(0);

    const rows = await testDb.db.query.schedule.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(body.id);
  });

  it("rejects invalid schedule payloads", async () => {
    const routes = createScheduleRoutes(testDb.db);
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({ activities: ["work"] }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: "Invalid schedule payload" });
  });

  it("updates an existing schedule", async () => {
    await testDb.db.insert(schedule).values({ id: "sched-2", activities });
    const updatedActivities = [
      "work",
      ...Array(23).fill("downtime"),
    ];

    const routes = createScheduleRoutes(testDb.db);
    const res = await routes.request("/sched-2", {
      method: "POST",
      body: JSON.stringify({ activities: updatedActivities }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activities).toEqual(updatedActivities);

    const row = await testDb.db.query.schedule.findFirst({
      where: (tbl, { eq }) => eq(tbl.id, "sched-2"),
    });
    expect(row?.activities).toEqual(updatedActivities);
  });

  it("returns 404 when updating a missing schedule", async () => {
    const routes = createScheduleRoutes(testDb.db);
    const res = await routes.request("/missing", {
      method: "POST",
      body: JSON.stringify({ activities }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Schedule not found" });
  });

  it("deletes a schedule", async () => {
    await testDb.db.insert(schedule).values({ id: "sched-3", activities });

    const routes = createScheduleRoutes(testDb.db);
    const res = await routes.request("/sched-3", { method: "DELETE" });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("sched-3");

    const rows = await testDb.db.query.schedule.findMany();
    expect(rows).toHaveLength(0);
  });

  it("returns 404 when deleting a missing schedule", async () => {
    const routes = createScheduleRoutes(testDb.db);
    const res = await routes.request("/missing", { method: "DELETE" });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Schedule not found" });
  });
});
