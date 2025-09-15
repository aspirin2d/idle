import { Hono } from "hono";
import db, { DEFAULT_SCHEDULE_ID } from "../db/index.js";
import { duplicant } from "../db/schema.js";
import type { NewDuplicant } from "../db/schema.js";

const duplicantRoute = new Hono();

duplicantRoute.get("/", async (c) => {
  const result = await db.select().from(duplicant);
  return c.json(result);
});

duplicantRoute.post("/", async (c) => {
  const body = await c.req.json<NewDuplicant>();
  const [created] = await db
    .insert(duplicant)
    .values({
      name: body.name,
      schedule: body.schedule ?? DEFAULT_SCHEDULE_ID,
    })
    .returning();
  return c.json(created, 201);
});

export default duplicantRoute;
