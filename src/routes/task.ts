import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";

import db from "../db/index.js";
import { task } from "../db/schema.js";
import type { NewTask } from "../db/schema.js";
import { parseRequestBody, removeUndefined } from "./utils.js";

type Database = typeof db;

const taskBaseShape = {
  description: z.string().min(1),
  skillId: z.string().min(1).optional(),
  skill: z.string().min(1).optional(),
  targetId: z.string().min(1).nullable().optional(),
  target: z.string().min(1).nullable().optional(),
} as const;

const taskBaseObject = z.object(taskBaseShape);

type TaskAliasInput = Pick<
  z.infer<typeof taskBaseObject>,
  "skillId" | "skill" | "targetId" | "target"
>;

function validateTaskAliases(data: TaskAliasInput, ctx: z.RefinementCtx) {
  if (
    data.skillId !== undefined &&
    data.skill !== undefined &&
    data.skillId !== data.skill
  ) {
    ctx.addIssue({
      code: "custom",
      message: "skill and skillId must match when both provided",
      path: ["skill"],
    });
  }

  if (
    data.targetId !== undefined &&
    data.target !== undefined &&
    data.targetId !== data.target
  ) {
    ctx.addIssue({
      code: "custom",
      message: "target and targetId must match when both provided",
      path: ["target"],
    });
  }
}

const taskCreateSchema = taskBaseObject
  .extend({
    id: z.string().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    validateTaskAliases(data, ctx);

    if (data.skillId == null && data.skill == null) {
      ctx.addIssue({
        code: "custom",
        message: "skillId is required",
        path: ["skillId"],
      });
    }
  });

const taskUpdateSchema = taskBaseObject.partial().superRefine((data, ctx) => {
  if (!Object.values(data).some((value) => value !== undefined)) {
    ctx.addIssue({
      code: "custom",
      message: "At least one field must be provided",
      path: [],
    });
  }

  validateTaskAliases(data, ctx);
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

    const { id, skillId, skill, targetId, target, ...rest } = parsed.data;
    const resolvedSkillId = skillId ?? skill!;
    const resolvedTargetId =
      targetId !== undefined ? targetId : target !== undefined ? target : null;

    const values: NewTask = {
      description: rest.description,
      skillId: resolvedSkillId,
      targetId: resolvedTargetId ?? null,
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

    const { skillId, skill, targetId, target, ...rest } = parsed.data;
    const updateData: Partial<NewTask> = removeUndefined(rest);

    const resolvedSkill = skillId ?? skill;
    if (resolvedSkill !== undefined) {
      updateData.skillId = resolvedSkill;
    }

    const resolvedTarget =
      targetId !== undefined
        ? targetId
        : target !== undefined
          ? target
          : undefined;
    if (resolvedTarget !== undefined) {
      updateData.targetId = resolvedTarget ?? null;
    }
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
