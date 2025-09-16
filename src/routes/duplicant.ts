import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";

import db, { DEFAULT_IDLE_TASK_ID, DEFAULT_SCHEDULE_ID } from "../db/index.js";
import { duplicant, stats } from "../db/schema.js";
import type { NewDuplicant } from "../db/schema.js";
import { parseRequestBody, removeUndefined } from "./utils.js";

type Database = typeof db;

const duplicantBaseSchema = z.object({
  name: z.string().min(1),
  taskId: z.string().min(1).nullable().optional(),
  scheduleId: z.string().min(1).nullable().optional(),
});

const duplicantCreateSchema = duplicantBaseSchema.extend({
  id: z.string().min(1).optional(),
});

const duplicantUpdateSchema = duplicantBaseSchema
  .partial()
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "At least one field must be provided",
  });

/** Defaults for a brand-new duplicant’s stats */
const DEFAULT_STATS = {
  stamina: 100,
  calories: 4000,
  bladder: 0,
} as const;

export function createDuplicantRoutes(database: Database = db) {
  const routes = new Hono();

  routes.get("/", async (c) => {
    const items = await database.query.duplicant.findMany({
      with: {
        schedule: true,
        task: true,
        stats: true,
      },
    });
    return c.json(items);
  });

  routes.get("/:id", async (c) => {
    const { id } = c.req.param();
    const result = await database.query.duplicant.findFirst({
      where: (duplicants, { eq }) => eq(duplicants.id, id),
      with: {
        schedule: true,
        task: true,
        stats: true,
      },
    });
    if (!result) {
      return c.json({ error: "Duplicant not found" }, 404);
    }
    return c.json(result);
  });

  routes.post("/", async (c) => {
    const parsed = await parseRequestBody(
      c,
      duplicantCreateSchema,
      "Invalid duplicant payload",
    );
    if (!parsed.success) return parsed.response;

    const { id, ...rest } = parsed.data;

    // Default to the global "idle" task when not provided
    const dupValuesBase: Omit<NewDuplicant, "statsId"> = {
      name: rest.name,
      taskId: rest.taskId ?? DEFAULT_IDLE_TASK_ID, // <— changed
      scheduleId: rest.scheduleId ?? DEFAULT_SCHEDULE_ID,
    };

    const hasTx = typeof (database as any).transaction === "function";

    if (hasTx) {
      const created = await (database as any).transaction(
        async (tx: Database) => {
          const [createdStats] = await tx
            .insert(stats)
            .values(DEFAULT_STATS)
            .returning();

          const dupValues: NewDuplicant = {
            ...dupValuesBase,
            statsId: createdStats.id,
            ...(id ? { id } : {}),
          };

          const [insertedDup] = await tx
            .insert(duplicant)
            .values(dupValues)
            .returning();

          // Link stats → duplicant (avoid orphaned stats row)
          await tx
            .update(stats)
            .set({ duplicantId: insertedDup.id })
            .where(eq(stats.id, createdStats.id));

          return insertedDup;
        },
      );
      return c.json(created, 201);
    }

    // Fallback (non-transactional)
    const [createdStats] = await (database as Database)
      .insert(stats)
      .values(DEFAULT_STATS)
      .returning();

    const dupValues: NewDuplicant = {
      ...dupValuesBase,
      statsId: createdStats.id,
      ...(id ? { id } : {}),
    };

    const [insertedDup] = await (database as Database)
      .insert(duplicant)
      .values(dupValues)
      .returning();

    // Link stats → duplicant even in non-tx path
    await (database as Database)
      .update(stats)
      .set({ duplicantId: insertedDup.id })
      .where(eq(stats.id, createdStats.id));

    return c.json(insertedDup, 201);
  });

  routes.post("/:id", async (c) => {
    const { id } = c.req.param();
    const parsed = await parseRequestBody(
      c,
      duplicantUpdateSchema,
      "Invalid duplicant payload",
    );
    if (!parsed.success) {
      return parsed.response;
    }

    const updateData = removeUndefined(parsed.data) as Partial<NewDuplicant>;
    const updated = await database
      .update(duplicant)
      .set(updateData)
      .where(eq(duplicant.id, id))
      .returning();
    if (updated.length === 0) {
      return c.json({ error: "Duplicant not found" }, 404);
    }
    return c.json(updated[0]);
  });

  routes.delete("/:id", async (c) => {
    const { id } = c.req.param();
    const deleted = await database
      .delete(duplicant)
      .where(eq(duplicant.id, id))
      .returning();
    if (deleted.length === 0) {
      return c.json({ error: "Duplicant not found" }, 404);
    }
    return c.json(deleted[0]);
  });

  return routes;
}

export const duplicantRoutes = createDuplicantRoutes();
