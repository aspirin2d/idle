import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";

import db from "../db/index.js";
import { task } from "../db/schema.js";
import type { NewTask } from "../db/schema.js";
import { parseRequestBody, removeUndefined } from "./utils.js";

type Database = typeof db;

const taskBaseSchema = z.object({
  description: z.string().min(1),
  skill: z.string().min(1),
  target: z.string().min(1).nullable().optional(),
});

const taskCreateSchema = taskBaseSchema.extend({
  id: z.string().min(1).optional(),
});

const taskUpdateSchema = taskBaseSchema
  .partial()
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "At least one field must be provided",
  });

export function createTaskRoutes(database: Database = db) {
  const routes = new Hono();

  routes.get("/", async (c) => {
    const items = await database.query.task.findMany({
      with: {
        duplicants: true,
      },
    });
    return c.json(items);
  });

  routes.get("/:id", async (c) => {
    const { id } = c.req.param();
    const result = await database.query.task.findFirst({
      where: (tasks, { eq }) => eq(tasks.id, id),
      with: {
        duplicants: true,
      },
    });
    if (!result) {
      return c.json({ error: "Task not found" }, 404);
    }
    return c.json(result);
  });

  routes.post("/", async (c) => {
    const parsed = await parseRequestBody(
      c,
      taskCreateSchema,
      "Invalid task payload",
    );
    if (!parsed.success) {
      return parsed.response;
    }

    const { id, ...rest } = parsed.data;
    const values: NewTask = {
      description: rest.description,
      skillId: rest.skill,
      targetId: rest.target ?? null,
    };
    if (id) {
      values.id = id;
    }

    const inserted = await database.insert(task).values(values).returning();
    return c.json(inserted[0], 201);
  });

  routes.post("/:id", async (c) => {
    const { id } = c.req.param();
    const parsed = await parseRequestBody(
      c,
      taskUpdateSchema,
      "Invalid task payload",
    );
    if (!parsed.success) {
      return parsed.response;
    }

    const updateData: Partial<NewTask> = removeUndefined(parsed.data);
    const updated = await database
      .update(task)
      .set(updateData)
      .where(eq(task.id, id))
      .returning();
    if (updated.length === 0) {
      return c.json({ error: "Task not found" }, 404);
    }
    return c.json(updated[0]);
  });

  routes.delete("/:id", async (c) => {
    const { id } = c.req.param();
    const deleted = await database
      .delete(task)
      .where(eq(task.id, id))
      .returning();
    if (deleted.length === 0) {
      return c.json({ error: "Task not found" }, 404);
    }
    return c.json(deleted[0]);
  });

  return routes;
}

export const taskRoutes = createTaskRoutes();
