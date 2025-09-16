import { inArray, sql } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import z from "zod";
import db from "../db/index.js";
import { skillTargetDef, type NewSkillTargetDef } from "../db/schema.js";

export const SkillTargetDefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  requirements: z.record(z.string(), z.unknown()).default({}),
  metadata: z.any().default({}),
});

export const SkillTargetFileSchema = z.union([
  z.array(SkillTargetDefSchema),
  z.object({ targets: z.array(SkillTargetDefSchema) }),
]);

export type ParsedSkillTargetDef = z.infer<typeof SkillTargetDefSchema>;

export function parseSkillTargetDefs(json: unknown): ParsedSkillTargetDef[] {
  const res = SkillTargetFileSchema.safeParse(json);
  if (!res.success) throw res.error;
  return Array.isArray(res.data) ? res.data : res.data.targets;
}

export function toNewSkillTargetDef(
  t: ParsedSkillTargetDef,
): NewSkillTargetDef {
  return {
    id: t.id,
    name: t.name,
    requirements: t.requirements,
    metadata: t.metadata,
  };
}

export async function loadSkillTargetDefsFromFile(filePath: string) {
  const raw = await readFile(filePath, "utf8");
  const json = JSON.parse(raw);
  return parseSkillTargetDefs(json);
}

export async function syncSkillTargetDefsFromFile(
  filePath = process.env.SKILL_TARGET_DEFS_PATH ?? "./data/skill-targets.json",
  opts: { prune?: boolean; dryRun?: boolean } = {},
) {
  const {
    prune = process.env.SKILL_TARGET_DEFS_PRUNE === "true",
    dryRun = false,
  } = opts;

  const parsed = await loadSkillTargetDefsFromFile(filePath);
  const rows = parsed.map(toNewSkillTargetDef);
  if (!rows.length) return { inserted: 0, updated: 0, pruned: 0, total: 0 };

  const ids = rows.map((r) => r.id);
  const existing = await db
    .select({ id: skillTargetDef.id })
    .from(skillTargetDef)
    .where(inArray(skillTargetDef.id, ids));
  const exist = new Set(existing.map((e) => e.id));
  const inserted = ids.filter((id) => !exist.has(id)).length;
  const updated = ids.length - inserted;

  if (dryRun) return { inserted, updated, pruned: 0, total: rows.length };

  await db
    .insert(skillTargetDef)
    .values(rows)
    .onConflictDoUpdate({
      target: skillTargetDef.id,
      set: {
        name: sql`excluded.name`,
        requirements: sql`excluded.requirements`,
        metadata: sql`excluded.metadata`,
        updatedAt: new Date(),
      },
    });

  let pruned = 0;
  if (prune) {
    const all = await db.select({ id: skillTargetDef.id }).from(skillTargetDef);
    const toPrune = all.map((r) => r.id).filter((id) => !ids.includes(id));
    if (toPrune.length) {
      await db
        .delete(skillTargetDef)
        .where(inArray(skillTargetDef.id, toPrune));
      pruned = toPrune.length;
    }
  }

  return { inserted, updated, pruned, total: rows.length };
}

export async function ensureSkillTargetDefsSyncedOnStart() {
  const path =
    process.env.SKILL_TARGET_DEFS_PATH ?? "./data/skill-targets.json";
  const optional = process.env.SKILL_TARGET_DEFS_OPTIONAL === "true";
  try {
    const res = await syncSkillTargetDefsFromFile(path);
    console.log(
      `[skill-targets] synced ${res.total} defs (inserted: ${res.inserted}, updated: ${res.updated}${
        res.pruned ? `, pruned: ${res.pruned}` : ""
      }) from ${path}`,
    );
  } catch (err: any) {
    if (err?.code === "ENOENT" || /no such file/i.test(String(err?.message))) {
      const msg = `[skill-targets] defs file not found at ${path}`;
      if (optional) return console.warn(`${msg}; skipping.`);
      console.warn(`${msg}. Set SKILL_TARGET_DEFS_OPTIONAL=true to skip.`);
    }
    throw err;
  }
}
