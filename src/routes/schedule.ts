import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";

import db from "../db/index.js";
import { schedule, scheduleActivityEnum } from "../db/schema.js";
import type { NewSchedule, ScheduleActivity } from "../db/schema.js";
import { parseRequestBody } from "./utils.js";

type Database = typeof db;

const scheduleActivitySchema = z.enum(
  scheduleActivityEnum.enumValues as [ScheduleActivity, ...ScheduleActivity[]],
);

const scheduleActivitiesSchema = z
  .array(scheduleActivitySchema)
  .length(24, { message: "activities must contain 24 entries" });

const scheduleCreateSchema = z.object({
  id: z.string().min(1).optional(),
  activities: scheduleActivitiesSchema,
});

const scheduleUpdateSchema = z.object({
  activities: scheduleActivitiesSchema,
});

export function createScheduleRoutes(database: Database = db) {
  const routes = new Hono();

  routes.get("/", async (c) => {
    const items = await database.query.schedule.findMany({
      with: {
        duplicants: true,
      },
    });
    return c.json(items);
  });

  routes.get("/:id", async (c) => {
    const { id } = c.req.param();
    const result = await database.query.schedule.findFirst({
      where: (schedules, { eq }) => eq(schedules.id, id),
      with: {
        duplicants: true,
      },
    });
    if (!result) {
      return c.json({ error: "Schedule not found" }, 404);
    }
    return c.json(result);
  });

  routes.post("/", async (c) => {
    const parsed = await parseRequestBody(
      c,
      scheduleCreateSchema,
      "Invalid schedule payload",
    );
    if (!parsed.success) {
      return parsed.response;
    }

    const { id, activities } = parsed.data;
    const values: NewSchedule = {
      activities,
    };
    if (id) {
      values.id = id;
    }

    const inserted = await database.insert(schedule).values(values).returning();
    return c.json(inserted[0], 201);
  });

  routes.post("/:id", async (c) => {
    const { id } = c.req.param();
    const parsed = await parseRequestBody(
      c,
      scheduleUpdateSchema,
      "Invalid schedule payload",
    );
    if (!parsed.success) {
      return parsed.response;
    }

    const updated = await database
      .update(schedule)
      .set(parsed.data)
      .where(eq(schedule.id, id))
      .returning();
    if (updated.length === 0) {
      return c.json({ error: "Schedule not found" }, 404);
    }
    return c.json(updated[0]);
  });

  routes.delete("/:id", async (c) => {
    const { id } = c.req.param();
    const deleted = await database
      .delete(schedule)
      .where(eq(schedule.id, id))
      .returning();
    if (deleted.length === 0) {
      return c.json({ error: "Schedule not found" }, 404);
    }
    return c.json(deleted[0]);
  });

  return routes;
}

export const scheduleRoutes = createScheduleRoutes();
