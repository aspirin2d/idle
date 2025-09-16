import z from "zod";
import type { NewItemDef } from "../db/schema.js";

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
  data: z.record(z.string(), z.unknown()).default({}),
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
    data: i.data,
  };
}
