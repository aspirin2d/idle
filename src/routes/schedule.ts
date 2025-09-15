import { Hono } from "hono";
import db from "../db/index.js";
import { schedule } from "../db/schema.js";
import type { NewSchedule } from "../db/schema.js";

const scheduleRoute = new Hono();

scheduleRoute.get("/", async (c) => {
  const result = await db.select().from(schedule);
  return c.json(result);
});

scheduleRoute.post("/", async (c) => {
  const body = await c.req.json<NewSchedule>();
  if (!Array.isArray(body.activities) || body.activities.length !== 24) {
    return c.text("activities must contain 24 items", 400);
  }
  const [created] = await db
    .insert(schedule)
    .values({ activities: body.activities })
    .returning();
  return c.json(created, 201);
});

export default scheduleRoute;
