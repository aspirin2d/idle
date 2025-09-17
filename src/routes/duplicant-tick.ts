import { Hono } from "hono";
import { eq } from "drizzle-orm";

import db from "../db/index.js";
import { duplicant } from "../db/schema.js";

type Database = typeof db;

export function createDuplicantTickRoutes(database: Database = db) {
  const routes = new Hono();

  routes.post("/:id/tick", async (c) => {
    const { id } = c.req.param();

    const existing = await database.query.duplicant.findFirst({
      where: (duplicants, { eq }) => eq(duplicants.id, id),
      // load all sub tables
      with: {
        stats: true,
        task: true,
        schedule: true,
      },
      columns: {
        id: true,
        updatedAt: true,
        createdAt: true,
      },
    });

    if (!existing) {
      return c.json({ error: "Duplicant not found" }, 404);
    }

    const currentTick = new Date();
    const previousTick =
      existing.updatedAt ?? existing.createdAt ?? currentTick;
    const windowMs = Math.max(
      0,
      currentTick.getTime() - previousTick.getTime(),
    );

    await database
      .update(duplicant)
      .set({ updatedAt: currentTick })
      .where(eq(duplicant.id, id));

    return c.json({
      duplicantId: id,
      window: {
        start: previousTick.toISOString(),
        end: currentTick.toISOString(),
        duration: windowMs,
      },
    });
  });

  return routes;
}

export const duplicantTickRoutes = createDuplicantTickRoutes();
