import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";

import db from "../db/index.js";
import { duplicant } from "../db/schema.js";
import type { NewDuplicant } from "../db/schema.js";
import { parseRequestBody, removeUndefined } from "./utils.js";

type Database = typeof db;

const duplicantBaseSchema = z.object({
  name: z.string().min(1),
  task: z.string().min(1).nullable().optional(),
  schedule: z.string().min(1).nullable().optional(),
});

const duplicantCreateSchema = duplicantBaseSchema.extend({
  id: z.string().min(1).optional(),
});

const duplicantUpdateSchema = duplicantBaseSchema
  .partial()
  .refine(
    (data) => Object.values(data).some((value) => value !== undefined),
    { message: "At least one field must be provided" },
  );

export function createDuplicantRoutes(database: Database = db) {
  const routes = new Hono();

  routes.get("/", async (c) => {
    const items = await database.select().from(duplicant);
    return c.json(items);
  });

  routes.get("/:id", async (c) => {
    const { id } = c.req.param();
    const result = await database
      .select()
      .from(duplicant)
      .where(eq(duplicant.id, id));
    if (result.length === 0) {
      return c.json({ error: "Duplicant not found" }, 404);
    }
    return c.json(result[0]);
  });

  routes.post("/", async (c) => {
    const parsed = await parseRequestBody(
      c,
      duplicantCreateSchema,
      "Invalid duplicant payload",
    );
    if (!parsed.success) {
      return parsed.response;
    }

    const { id, ...rest } = parsed.data;
    const values: NewDuplicant = {
      name: rest.name,
      task: rest.task ?? null,
      schedule: rest.schedule ?? null,
    };
    if (id) {
      values.id = id;
    }

    const inserted = await database
      .insert(duplicant)
      .values(values)
      .returning();
    return c.json(inserted[0], 201);
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

    const updateData: Partial<NewDuplicant> = removeUndefined(parsed.data);
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
