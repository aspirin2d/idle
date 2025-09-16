import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import db from "../db/index.js";
import {
  duplicantInventory,
  itemDef,
  duplicant as duplicantTable,
} from "../db/schema.js";
import type { NewDuplicantInventory } from "../db/schema.js";
import { parseRequestBody } from "./utils.js";

type Database = typeof db;

/* ----------------------------- Schemas ----------------------------- */

const idSchema = z.string().min(1);

const createSchema = z.object({
  duplicant: idSchema,
  slot: z.number().int().min(0),
  item: idSchema,
  qty: z.number().int().min(1).optional().default(1),
  durability: z.number().int().min(0).optional(),
  // if true and target slot has same item, quantities will merge (capped by stackMax)
  merge: z.boolean().optional().default(false),
});

const updateSchema = z
  .object({
    qty: z.number().int().min(0).optional(), // 0 => delete
    durability: z.number().int().min(0).optional(),
    slot: z.number().int().min(0).optional(), // allow direct re-slot (no swap)
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

const moveSchema = z.object({
  duplicant: idSchema,
  fromSlot: z.number().int().min(0),
  toSlot: z.number().int().min(0),
  // if true and same item in toSlot, merge up to stackMax (leftover stays in fromSlot)
  merge: z.boolean().optional().default(true),
  // if false and toSlot occupied with different item (or overflow), swap instead of error
  allowSwap: z.boolean().optional().default(true),
});

/* ----------------------------- Helpers ----------------------------- */

async function assertDuplicant(database: Database, duplicantId: string) {
  const exists = await database
    .select({ id: duplicantTable.id })
    .from(duplicantTable)
    .where(eq(duplicantTable.id, duplicantId));
  if (exists.length === 0) throw new Error("Duplicant not found");
}

async function getItemDef(database: Database, itemId: string) {
  const rows = await database
    .select({
      id: itemDef.id,
      name: itemDef.name,
      stackMax: itemDef.stackMax,
    })
    .from(itemDef)
    .where(eq(itemDef.id, itemId));
  if (rows.length === 0) throw new Error("Item definition not found");
  return rows[0];
}

async function getStackBySlot(
  database: Database,
  duplicantId: string,
  slot: number,
) {
  const rows = await database
    .select()
    .from(duplicantInventory)
    .where(
      and(
        eq(duplicantInventory.duplicantId, duplicantId),
        eq(duplicantInventory.slot, slot),
      ),
    );
  return rows[0] ?? null;
}

async function getStackById(database: Database, id: string) {
  const rows = await database
    .select()
    .from(duplicantInventory)
    .where(eq(duplicantInventory.id, id));
  return rows[0] ?? null;
}

/* ------------------------------ Routes ------------------------------ */

export function createInventoryRoutes(database: Database = db) {
  const routes = new Hono();

  // List all stacks for a duplicant
  routes.get("/", async (c) => {
    const duplicantId = c.req.query("duplicant");
    if (!duplicantId) {
      return c.json({ error: "Missing 'duplicant' query param" }, 400);
    }
    const items = await database
      .select()
      .from(duplicantInventory)
      .where(eq(duplicantInventory.duplicantId, duplicantId));
    return c.json(items);
  });

  // Get a stack by id
  routes.get("/:id", async (c) => {
    const { id } = c.req.param();
    const row = await getStackById(database, id);
    if (!row) return c.json({ error: "Inventory stack not found" }, 404);
    return c.json(row);
  });

  // Create a stack in specific slot (optionally merge if same item)
  routes.post("/", async (c) => {
    const parsed = await parseRequestBody(
      c,
      createSchema,
      "Invalid inventory payload",
    );
    if (!parsed.success) return parsed.response;

    const { duplicant, slot, item, qty, durability, merge } = parsed.data;

    try {
      // Validate duplicant + item, get stackMax
      await assertDuplicant(database, duplicant);
      const def = await getItemDef(database, item);

      if (qty > def.stackMax) {
        return c.json({ error: `qty exceeds stackMax (${def.stackMax})` }, 400);
      }

      const hasTx = typeof (database as any).transaction === "function";
      const exec = hasTx
        ? (fn: (tx: Database) => Promise<any>) =>
            (database as any).transaction(fn)
        : async (fn: (tx: Database) => Promise<any>) => fn(database);

      const created = await exec(async (tx: Database) => {
        const existingAtSlot = await getStackBySlot(tx, duplicant, slot);

        // If slot empty → insert
        if (!existingAtSlot) {
          const [inserted] = await tx
            .insert(duplicantInventory)
            .values({
              duplicantId: duplicant,
              slot,
              itemId: item,
              qty,
              durability,
            } satisfies NewDuplicantInventory)
            .returning();
          return inserted;
        }

        // Slot occupied
        if (!merge) {
          return Promise.reject(
            new Error("Slot occupied. Use merge=true or move endpoint."),
          );
        }

        // Merge only if same item
        if (existingAtSlot.itemId !== item) {
          return Promise.reject(
            new Error("Cannot merge different items in the same slot"),
          );
        }

        const newQty = existingAtSlot.qty + qty;
        if (newQty > def.stackMax) {
          return Promise.reject(
            new Error(`Merge would exceed stackMax (${def.stackMax})`),
          );
        }

        const [updated] = await tx
          .update(duplicantInventory)
          .set({
            qty: newQty,
            // keep durability as-is unless provided (optional simple rule)
            ...(durability != null ? { durability } : {}),
          })
          .where(eq(duplicantInventory.id, existingAtSlot.id))
          .returning();
        return updated;
      });

      return c.json(created, 201);
    } catch (err: any) {
      return c.json(
        { error: err.message ?? "Failed to create inventory" },
        400,
      );
    }
  });

  // Update a stack by id (qty/durability/slot). qty=0 deletes.
  routes.post("/:id", async (c) => {
    const { id } = c.req.param();
    const parsed = await parseRequestBody(
      c,
      updateSchema,
      "Invalid inventory payload",
    );
    if (!parsed.success) return parsed.response;

    const body = parsed.data;

    const current = await getStackById(database, id);
    if (!current) return c.json({ error: "Inventory stack not found" }, 404);

    // If moving to another slot, ensure uniqueness
    if (body.slot != null) {
      const atTarget = await getStackBySlot(
        database,
        current.duplicantId,
        body.slot,
      );
      if (atTarget) {
        return c.json(
          {
            error: "Target slot occupied. Use /inventory/move for swap/merge.",
          },
          400,
        );
      }
    }

    // qty=0 → delete
    if (body.qty === 0) {
      const [deleted] = await database
        .delete(duplicantInventory)
        .where(eq(duplicantInventory.id, id))
        .returning();
      return c.json(deleted ?? { id, deleted: true });
    }

    // Validate stackMax when qty provided
    if (body.qty != null) {
      const def = await getItemDef(database, current.itemId);
      if (body.qty > def.stackMax) {
        return c.json({ error: `qty exceeds stackMax (${def.stackMax})` }, 400);
      }
    }

    const [updated] = await database
      .update(duplicantInventory)
      .set({
        ...(body.qty != null ? { qty: body.qty } : {}),
        ...(body.durability != null ? { durability: body.durability } : {}),
        ...(body.slot != null ? { slot: body.slot } : {}),
      })
      .where(eq(duplicantInventory.id, id))
      .returning();

    return c.json(updated);
  });

  // Move/swap/merge between slots
  routes.post("/move", async (c) => {
    const parsed = await parseRequestBody(
      c,
      moveSchema,
      "Invalid move payload",
    );
    if (!parsed.success) return parsed.response;

    const { duplicant, fromSlot, toSlot, merge, allowSwap } = parsed.data;

    try {
      await assertDuplicant(database, duplicant);

      const hasTx = typeof (database as any).transaction === "function";
      const exec = hasTx
        ? (fn: (tx: Database) => Promise<any>) =>
            (database as any).transaction(fn)
        : async (fn: (tx: Database) => Promise<any>) => fn(database);

      const result = await exec(async (tx: Database) => {
        const from = await getStackBySlot(tx, duplicant, fromSlot);
        if (!from) throw new Error("No stack in fromSlot");

        const to = await getStackBySlot(tx, duplicant, toSlot);

        // Simple move if to is empty
        if (!to) {
          const [moved] = await tx
            .update(duplicantInventory)
            .set({ slot: toSlot })
            .where(eq(duplicantInventory.id, from.id))
            .returning();
          return { action: "move", moved };
        }

        // Attempt merge
        if (merge && to.itemId === from.itemId) {
          const def = await getItemDef(tx, from.itemId);
          const total = from.qty + to.qty;
          if (total <= def.stackMax) {
            // All fits in 'to', delete 'from'
            const [updatedTo] = await tx
              .update(duplicantInventory)
              .set({ qty: total })
              .where(eq(duplicantInventory.id, to.id))
              .returning();

            await tx
              .delete(duplicantInventory)
              .where(eq(duplicantInventory.id, from.id));

            return { action: "merge_all_into_to", updated: updatedTo };
          } else {
            // Partial merge up to stackMax, leave remainder in from
            const remainder = total - def.stackMax;
            const [updatedTo] = await tx
              .update(duplicantInventory)
              .set({ qty: def.stackMax })
              .where(eq(duplicantInventory.id, to.id))
              .returning();

            const [updatedFrom] = await tx
              .update(duplicantInventory)
              .set({ qty: remainder })
              .where(eq(duplicantInventory.id, from.id))
              .returning();

            return {
              action: "merge_partial",
              to: updatedTo,
              from: updatedFrom,
            };
          }
        }

        // Swap if allowed
        if (allowSwap) {
          const [movedFrom] = await tx
            .update(duplicantInventory)
            .set({ slot: toSlot })
            .where(eq(duplicantInventory.id, from.id))
            .returning();

          const [movedTo] = await tx
            .update(duplicantInventory)
            .set({ slot: fromSlot })
            .where(eq(duplicantInventory.id, to.id))
            .returning();

          return { action: "swap", a: movedFrom, b: movedTo };
        }

        throw new Error("Target slot occupied and merge/swap not permitted");
      });

      return c.json(result);
    } catch (err: any) {
      return c.json({ error: err.message ?? "Move failed" }, 400);
    }
  });

  // Delete a stack
  routes.delete("/:id", async (c) => {
    const { id } = c.req.param();
    const [deleted] = await database
      .delete(duplicantInventory)
      .where(eq(duplicantInventory.id, id))
      .returning();
    if (!deleted) return c.json({ error: "Inventory stack not found" }, 404);
    return c.json(deleted);
  });

  return routes;
}

export const inventoryRoutes = createInventoryRoutes();
