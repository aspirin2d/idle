import { beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { sql } from "drizzle-orm";

process.env.PG_DATA = ":memory:";

// Dynamic imports to ensure PG_DATA is set before modules load
let scheduleRoute: Hono;
let duplicantRoute: Hono;
let db: any;
let ensureDefaultSchedule: any;
let DEFAULT_SCHEDULE_ID: string;
let DEFAULT_SCHEDULE_ACTIVITIES: string[];
let app: Hono;

beforeAll(async () => {
  const dbModule = await import("../src/db/index.js");
  db = dbModule.default;
  ensureDefaultSchedule = dbModule.ensureDefaultSchedule;
  DEFAULT_SCHEDULE_ID = dbModule.DEFAULT_SCHEDULE_ID;
  DEFAULT_SCHEDULE_ACTIVITIES = dbModule.DEFAULT_SCHEDULE_ACTIVITIES;
  scheduleRoute = (await import("../src/routes/schedule.js")).default;
  duplicantRoute = (await import("../src/routes/duplicant.js")).default;
  app = new Hono();
  app.route("/schedules", scheduleRoute);
  app.route("/duplicants", duplicantRoute);

  await db.execute(sql`DROP TYPE IF EXISTS schedule_activity CASCADE`);
  await db.execute(sql`
    CREATE TYPE schedule_activity AS ENUM ('work','bedtime','downtime','bathtime')
  `);
  await db.execute(sql`DROP TABLE IF EXISTS schedule CASCADE`);
  await db.execute(sql`
    CREATE TABLE schedule (
      id text PRIMARY KEY,
      activities schedule_activity[24] NOT NULL
    )
  `);
  await db.execute(sql`DROP TABLE IF EXISTS duplicant CASCADE`);
  await db.execute(sql`
    CREATE TABLE duplicant (
      id text PRIMARY KEY,
      name text NOT NULL,
      schedule_id text REFERENCES schedule(id),
      created_at timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
    )
  `);
  await ensureDefaultSchedule();
});

describe("API routes", () => {
  it("seeds a 9-to-5 work default schedule", () => {
    expect(DEFAULT_SCHEDULE_ACTIVITIES.slice(0, 8)).toEqual(
      Array(8).fill("bedtime"),
    );
    expect(DEFAULT_SCHEDULE_ACTIVITIES[8]).toBe("bathtime");
    expect(DEFAULT_SCHEDULE_ACTIVITIES.slice(9, 17)).toEqual(
      Array(8).fill("work"),
    );
    expect(DEFAULT_SCHEDULE_ACTIVITIES.slice(17)).toEqual(
      Array(7).fill("downtime"),
    );
  });

  it("creates and lists schedules", async () => {
    const activities = Array(24).fill("work");
    const create = await app.request("/schedules", {
      method: "POST",
      body: JSON.stringify({ activities }),
      headers: { "Content-Type": "application/json" },
    });
    expect(create.status).toBe(201);
    const created = await create.json();
    expect(created.activities).toHaveLength(24);

    const list = await app.request("/schedules");
    const schedules = await list.json();
    const defaultSchedule = schedules.find(
      (s: any) => s.id === DEFAULT_SCHEDULE_ID,
    );
    expect(defaultSchedule).toBeDefined();
    expect(defaultSchedule.activities).toEqual(DEFAULT_SCHEDULE_ACTIVITIES);
    expect(schedules.length).toBe(2);
  });

  it("rejects schedules with fewer than 24 activities", async () => {
    const activities = Array(23).fill("work");
    const res = await app.request("/schedules", {
      method: "POST",
      body: JSON.stringify({ activities }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });

  it("creates duplicant without schedule", async () => {
    const create = await app.request("/duplicants", {
      method: "POST",
      body: JSON.stringify({ name: "Bubbles" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(create.status).toBe(201);
    const created = await create.json();
    expect(created.name).toBe("Bubbles");
    expect(created.scheduleId).toBe(DEFAULT_SCHEDULE_ID);

    const list = await app.request("/duplicants");
    const duplicants = await list.json();
    expect(duplicants.length).toBe(1);
  });
});
