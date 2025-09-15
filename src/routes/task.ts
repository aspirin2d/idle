import { Hono } from "hono";
import db from "../db/index.js";
import { task, TASK_STATUS } from "../db/schema.js";
import type { NewTask } from "../db/schema.js";
import { eq, asc, desc, and, ne } from "drizzle-orm";

const taskRoute = new Hono();

// Schedule the next task so only one is in progress for a duplicant.
export async function scheduleNextTask(duplicantId: string) {
  // Reset any running task to pending first
  await db
    .update(task)
    .set({ status: TASK_STATUS.PENDING })
    .where(
      and(
        eq(task.duplicantId, duplicantId),
        eq(task.status, TASK_STATUS.IN_PROGRESS),
      ),
    );

  // Find next task based on priority then creation time
  const [next] = await db
    .select()
    .from(task)
    .where(
      and(eq(task.duplicantId, duplicantId), ne(task.status, TASK_STATUS.COMPLETE)),
    )
    .orderBy(desc(task.priority), asc(task.createdAt))
    .limit(1);

  if (next) {
    await db
      .update(task)
      .set({ status: TASK_STATUS.IN_PROGRESS })
      .where(eq(task.id, next.id));
  }
}

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

// GET /duplicants/:id/tasks/current
taskRoute.get("/duplicants/:id/tasks/current", async (c) => {
  const duplicantId = c.req.param("id");
  const [current] = await db
    .select()
    .from(task)
    .where(
      and(
        eq(task.duplicantId, duplicantId),
        eq(task.status, TASK_STATUS.IN_PROGRESS),
      ),
    )
    .limit(1);
  if (!current) return c.notFound();
  return c.json(current);
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
      status: body.status ?? TASK_STATUS.PENDING,
    })
    .returning();
  await scheduleNextTask(duplicantId);
  return c.json(created, 201);
});

// DELETE /tasks/:taskId
taskRoute.delete("/tasks/:taskId", async (c) => {
  const taskId = c.req.param("taskId");
  const [deleted] = await db
    .delete(task)
    .where(eq(task.id, taskId))
    .returning();
  if (!deleted) return c.notFound();
  await scheduleNextTask(deleted.duplicantId);
  return c.json(deleted);
});

// POST /tasks/:taskId/claim
taskRoute.post("/tasks/:taskId/claim", async (c) => {
  const taskId = c.req.param("taskId");
  const [claimed] = await db
    .update(task)
    .set({ status: TASK_STATUS.COMPLETE })
    .where(eq(task.id, taskId))
    .returning();
  if (!claimed) return c.notFound();
  await scheduleNextTask(claimed.duplicantId);
  return c.json(claimed);
});

export default taskRoute;
