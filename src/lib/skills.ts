import { inArray, sql } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import z from "zod";
import db from "../db/index.js";
import { skillDef, type NewSkillDef } from "../db/schema.js";

export const SkillDefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  priority: z.number().int().min(-32768).max(32767).default(0),
  /** renamed from `data` */
  requirements: z.record(z.string(), z.unknown()).default({}),
  metadata: z.any().default({}),
});

export const SkillDefFileSchema = z.union([
  z.array(SkillDefSchema),
  z.object({ skills: z.array(SkillDefSchema) }),
]);

export type ParsedSkillDef = z.infer<typeof SkillDefSchema>;

export function parseSkillDefs(json: unknown): ParsedSkillDef[] {
  const res = SkillDefFileSchema.safeParse(json);
  if (!res.success) throw res.error;
  return Array.isArray(res.data) ? res.data : res.data.skills;
}

export function toNewSkillDef(s: ParsedSkillDef): NewSkillDef {
  return {
    id: s.id,
    name: s.name,
    priority: s.priority,
    requirements: s.requirements,
    metadata: s.metadata,
  };
}

export async function loadSkillDefsFromFile(filePath: string) {
  const raw = await readFile(filePath, "utf8");
  const json = JSON.parse(raw);
  return parseSkillDefs(json);
}

export async function syncSkillDefsFromFile(
  filePath = process.env.SKILL_DEFS_PATH ?? "./data/skills.json",
  opts: { prune?: boolean; dryRun?: boolean } = {},
) {
  const { prune = process.env.SKILL_DEFS_PRUNE === "true", dryRun = false } =
    opts;

  const parsed = await loadSkillDefsFromFile(filePath);
  const rows = parsed.map(toNewSkillDef);
  if (rows.length === 0)
    return { inserted: 0, updated: 0, pruned: 0, total: 0 };

  const ids = rows.map((r) => r.id);
  const selectFn = (db as any)?.select;
  const existingRows = await (async () => {
    if (typeof selectFn !== "function") return [] as Array<{ id: string }>;
    const builder = selectFn.call(db, { id: skillDef.id });
    if (!builder || typeof builder.from !== "function")
      return [] as Array<{ id: string }>;
    const fromResult = builder.from(skillDef);
    if (!fromResult || typeof fromResult.where !== "function")
      return [] as Array<{ id: string }>;
    const result = await fromResult.where(inArray(skillDef.id, ids));
    return Array.isArray(result) ? result : [];
  })();

  const existingSet = new Set(existingRows.map((e) => e.id));
  const inserted = ids.filter((id) => !existingSet.has(id)).length;
  const updated = ids.length - inserted;

  if (dryRun) return { inserted, updated, pruned: 0, total: rows.length };

  const insertFn = (db as any)?.insert;
  const insertBuilder =
    typeof insertFn === "function" ? insertFn.call(db, skillDef) : undefined;
  const valuesFn = insertBuilder && typeof insertBuilder.values === "function"
    ? insertBuilder.values.bind(insertBuilder)
    : undefined;

  if (!valuesFn) {
    return { inserted, updated, pruned: 0, total: rows.length };
  }

  const onConflictBuilder = valuesFn(rows);
  const onConflictFn =
    onConflictBuilder &&
    typeof onConflictBuilder.onConflictDoUpdate === "function"
      ? onConflictBuilder.onConflictDoUpdate.bind(onConflictBuilder)
      : undefined;

  if (!onConflictFn) {
    return { inserted, updated, pruned: 0, total: rows.length };
  }

  await onConflictFn({
    target: skillDef.id,
    set: {
      name: sql`excluded.name`,
      priority: sql`excluded.priority`,
      requirements: sql`excluded.requirements`,
      metadata: sql`excluded.metadata`,
      updatedAt: new Date(),
    },
  });

  let pruned = 0;
  if (prune) {
    const all = await (async () => {
      if (typeof selectFn !== "function") return [] as Array<{ id: string }>;
      const builder = selectFn.call(db, { id: skillDef.id });
      if (!builder || typeof builder.from !== "function")
        return [] as Array<{ id: string }>;
      const result = await builder.from(skillDef);
      return Array.isArray(result) ? result : [];
    })();
    const toPrune = all.map((r) => r.id).filter((id) => !ids.includes(id));
    if (toPrune.length) {
      const deleteFn = (db as any)?.delete;
      const deleteBuilder =
        typeof deleteFn === "function"
          ? deleteFn.call(db, skillDef)
          : undefined;
      if (deleteBuilder && typeof deleteBuilder.where === "function") {
        await deleteBuilder.where(inArray(skillDef.id, toPrune));
      }
      pruned = toPrune.length;
    }
  }

  return { inserted, updated, pruned, total: rows.length };
}

export async function ensureSkillDefsSyncedOnStart() {
  const path = process.env.SKILL_DEFS_PATH ?? "./data/skills.json";
  const optional = process.env.SKILL_DEFS_OPTIONAL === "true";
  try {
    const res = await syncSkillDefsFromFile(path);
    console.log(
      `[skills] synced ${res.total} defs (inserted: ${res.inserted}, updated: ${res.updated}${
        res.pruned ? `, pruned: ${res.pruned}` : ""
      }) from ${path}`,
    );
  } catch (err: any) {
    if (err?.code === "ENOENT" || /no such file/i.test(String(err?.message))) {
      const msg = `[skills] skill defs file not found at ${path}`;
      if (optional) return console.warn(`${msg}; skipping.`);
      console.warn(`${msg}. Set SKILL_DEFS_OPTIONAL=true to skip.`);
    }
    throw err;
  }
}
