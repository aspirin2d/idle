import { inArray, sql } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import z from "zod";
import db from "../db/index.js";
import { itemDef, type NewItemDef } from "../db/schema.js";

// Canonical categories must match itemCategoryEnum
export const ItemCategorySchema = z.enum([
  "material",
  "consumable",
  "tool",
  "equipment",
  "quest",
  "junk",
] as const);

export const ItemDefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: ItemCategorySchema,
  stack: z
    .object({
      max: z.number().int().min(1).max(30_000), // smallint range
      default: z.number().int().min(1).max(30_000).optional(),
    })
    .default({ max: 1 }),
  weight: z.number().int().min(0).max(30_000).default(0),
  // free-form extra properties (effects, flavor, rarity, etc.)
  metadata: z.record(z.string(), z.unknown()).default({}),
});

// Accept either a flat array or `{ items: [...] }`
export const ItemDefFileSchema = z.union([
  z.array(ItemDefSchema),
  z.object({ items: z.array(ItemDefSchema) }),
]);

export type ParsedItemDef = z.infer<typeof ItemDefSchema>;

/** Normalize file content to an array of item defs */
export function parseItemDefs(json: unknown): ParsedItemDef[] {
  const res = ItemDefFileSchema.safeParse(json);
  if (!res.success) throw res.error;
  return Array.isArray(res.data) ? res.data : res.data.items;
}

/** Map parsed Zod item to DB insert shape */
export function toNewItemDef(i: ParsedItemDef): NewItemDef {
  return {
    id: i.id,
    name: i.name,
    category: i.category,
    stackMax: i.stack.max,
    weight: i.weight,
    metadata: i.metadata,
  };
}
/**
 * Reads and parses item definitions from a JSON file.
 * Accepts either an array of items or { items: [...] } as per ItemDefFileSchema.
 */
export async function loadItemDefsFromFile(filePath: string) {
  const raw = await readFile(filePath, "utf8");
  const json = JSON.parse(raw);
  return parseItemDefs(json);
}

/**
 * Upserts item defs into the DB.
 * - Updates name/category/stackMax/weight/data, refreshes updatedAt
 * - Returns summary counts
 */
export async function syncItemDefsFromFile(
  filePath = process.env.ITEM_DEFS_PATH ?? "./data/items.json",
  opts: { prune?: boolean; dryRun?: boolean } = {},
) {
  const { prune = process.env.ITEM_DEFS_PRUNE === "true", dryRun = false } =
    opts;

  // 1) Load & normalize
  const parsed = await loadItemDefsFromFile(filePath);
  const rows = parsed.map(toNewItemDef);

  if (rows.length === 0) {
    return { inserted: 0, updated: 0, pruned: 0, total: 0 };
  }

  // 2) Figure out what exists to compute inserted/updated counts
  const ids = rows.map((r) => r.id);
  const existing = await db
    .select({ id: itemDef.id })
    .from(itemDef)
    .where(inArray(itemDef.id, ids));

  const existingSet = new Set(existing.map((e) => e.id));
  const insertedCount = ids.filter((id) => !existingSet.has(id)).length;
  const updatedCount = ids.length - insertedCount;

  if (dryRun) {
    return {
      inserted: insertedCount,
      updated: updatedCount,
      pruned: 0,
      total: rows.length,
    };
  }

  // 3) Upsert in a single statement
  await db
    .insert(itemDef)
    .values(
      rows.map((r) => ({
        ...r,
        // createdAt left to default; updatedAt set explicitly on update path
      })),
    )
    .onConflictDoUpdate({
      target: itemDef.id,
      set: {
        name: sql`excluded.name`,
        category: sql`excluded.category`,
        stackMax: sql`excluded.stack_max`,
        weight: sql`excluded.weight`,
        metadata: sql`excluded.metadata`,
        updatedAt: new Date(), // keep timestamps consistent
      },
    });

  // 4) Optional pruning (delete defs not present in file)
  let pruned = 0;
  if (prune) {
    const dbAll = await db.select({ id: itemDef.id }).from(itemDef);
    const fileIdSet = new Set(ids);
    const toPrune = dbAll.map((r) => r.id).filter((id) => !fileIdSet.has(id));
    if (toPrune.length) {
      await db.delete(itemDef).where(inArray(itemDef.id, toPrune));
      pruned = toPrune.length;
    }
  }

  return {
    inserted: insertedCount,
    updated: updatedCount,
    pruned,
    total: rows.length,
  };
}

/**
 * Convenience wrapper that is safe to call during startup.
 * - Missing file: logs and skips
 * - Validation errors: throws (fail fast) unless ITEM_DEFS_OPTIONAL=true
 */
export async function ensureItemDefsSyncedOnStart() {
  const path = process.env.ITEM_DEFS_PATH ?? "./data/items.json";
  const optional = process.env.ITEM_DEFS_OPTIONAL === "true";

  try {
    const res = await syncItemDefsFromFile(path);
    console.log(
      `[items] synced ${res.total} defs (inserted: ${res.inserted}, updated: ${res.updated}${
        res.pruned ? `, pruned: ${res.pruned}` : ""
      }) from ${path}`,
    );
  } catch (err: any) {
    if (err?.code === "ENOENT" || /no such file/i.test(String(err?.message))) {
      const msg = `[items] item defs file not found at ${path}`;
      if (optional) {
        console.warn(`${msg}; skipping.`);
        return;
      }
      console.warn(`${msg}. Set ITEM_DEFS_OPTIONAL=true to skip.`);
    }
    throw err;
  }
}
