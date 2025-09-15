import { Hono } from "hono";
import db from "../db/index.js";
import { task } from "../db/schema.js";
import type { NewTask } from "../db/schema.js";
import { eq, asc, desc } from "drizzle-orm";

const taskRoute = new Hono();

// GET /duplicants/:id/tasks
taskRoute.get("/duplicants/:id/tasks", async (c) => {
  const duplicantId = c.req.param("id");
  const result = await db
    .select()
    .from(task)
    .where(eq(task.duplicantId, duplicantId))
    .orderBy(desc(task.priority), asc(task.createdAt));
  return c.json(result);
});

// POST /duplicants/:id/tasks
taskRoute.post("/duplicants/:id/tasks", async (c) => {
  const duplicantId = c.req.param("id");
  const body =
    await c.req.json<
      Pick<NewTask, "description" | "status" | "duration" | "priority">
    >();
  const [created] = await db
    .insert(task)
    .values({
      duplicantId,
      description: body.description,
      duration: body.duration,
      priority: body.priority ?? 5,
      status: body.status ?? "pending",
    })
    .returning();
  return c.json(created, 201);
});

// PATCH /tasks/:taskId
taskRoute.patch("/tasks/:taskId", async (c) => {
  const taskId = c.req.param("taskId");
  const body =
    await c.req.json<
      Partial<Pick<NewTask, "description" | "status" | "duration" | "priority">>
    >();
  const updateData: Record<string, any> = {};
  if (body.description !== undefined) updateData.description = body.description;
  if (body.status !== undefined) updateData.status = body.status;
  if (body.duration !== undefined) updateData.duration = body.duration;
  if (body.priority !== undefined) updateData.priority = body.priority;
  const [updated] = await db
    .update(task)
    .set(updateData)
    .where(eq(task.id, taskId))
    .returning();
  return c.json(updated);
});

export default taskRoute;
