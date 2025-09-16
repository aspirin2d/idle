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
  const existing = await db
    .select({ id: skillDef.id })
    .from(skillDef)
    .where(inArray(skillDef.id, ids));
  const existingSet = new Set(existing.map((e) => e.id));
  const inserted = ids.filter((id) => !existingSet.has(id)).length;
  const updated = ids.length - inserted;

  if (dryRun) return { inserted, updated, pruned: 0, total: rows.length };

  await db
    .insert(skillDef)
    .values(rows)
    .onConflictDoUpdate({
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
    const all = await db.select({ id: skillDef.id }).from(skillDef);
    const toPrune = all.map((r) => r.id).filter((id) => !ids.includes(id));
    if (toPrune.length) {
      await db.delete(skillDef).where(inArray(skillDef.id, toPrune));
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
