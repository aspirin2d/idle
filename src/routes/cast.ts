import { Hono, type Context } from "hono";
import z from "zod";
import db from "../db/index.js";
import { cast } from "../db/schema.js";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/* ----------------------------- ENV ----------------------------- */

const RawEnv = {
  CAST_UNLIMITED_CAP: process.env.CAST_UNLIMITED_CAP,
  CAST_DEFAULT_CLAIM_MAX: process.env.CAST_DEFAULT_CLAIM_MAX, // "null"|"unlimited"|number
  CAST_MIN_CLAIM_INTERVAL_MS: process.env.CAST_MIN_CLAIM_INTERVAL_MS,
};

const EnvSchema = z.object({
  CAST_UNLIMITED_CAP: z.coerce.number().int().positive().default(1000),
  CAST_MIN_CLAIM_INTERVAL_MS: z.coerce.number().int().min(1).default(250),
});
const baseEnv = EnvSchema.parse(RawEnv);

// Allow “null”/“unlimited” for default claim max, or a positive integer
const DEFAULT_CLAIM_MAX: number | null = (() => {
  const v = RawEnv.CAST_DEFAULT_CLAIM_MAX;
  if (v == null || v === "") return 1; // previous behavior
  const lower = String(v).toLowerCase();
  if (lower === "null" || lower === "unlimited") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
})();

const UNLIMITED_CAP = baseEnv.CAST_UNLIMITED_CAP; // hard cap for unlimited
const MIN_CLAIM_INTERVAL_MS = baseEnv.CAST_MIN_CLAIM_INTERVAL_MS; // skill.min interval

/* ----------------------------- Helpers ----------------------------- */

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

type CastRow = typeof cast.$inferSelect;

const toMs = (d: string | Date) => new Date(d).getTime();

function ticksElapsed(row: CastRow, atMs: number): number {
  const elapsed = atMs - toMs(row.startedAt);
  if (elapsed <= 0) return 0;
  return Math.floor(elapsed / row.claimInterval);
}
function maxRuns(row: CastRow): number {
  // When unlimited (claimMax == null), use the hard cap.
  return row.claimMax == null ? UNLIMITED_CAP : row.claimMax;
}
function availableRuns(row: CastRow, atMs: number): number {
  const done = Math.min(ticksElapsed(row, atMs), maxRuns(row));
  return Math.max(0, done - row.claimed);
}
function nextEta(row: CastRow, atMs: number): number {
  if (availableRuns(row, atMs) > 0) return 0;
  const elapsed = atMs - toMs(row.startedAt);
  const into =
    ((elapsed % row.claimInterval) + row.claimInterval) % row.claimInterval;
  return row.claimInterval - into;
}
async function getActive(): Promise<CastRow | null> {
  const rows = await db
    .select()
    .from(cast)
    .where(isNull(cast.endedAt))
    .orderBy(desc(cast.startedAt))
    .limit(1);
  return rows[0] ?? null;
}

function sendError(c: Context, message: string, status: ContentfulStatusCode) {
  return c.json({ error: { message } }, status);
}

/* ----------------------------- Demo data ----------------------------- */

const skillSchema = z.object({
  id: z.string(),
  name: z.string(),
  claimInterval: z.number().int().min(MIN_CLAIM_INTERVAL_MS),
});
const targetSchema = z.object({ id: z.string(), name: z.string() });
type Skill = z.infer<typeof skillSchema>;
type Target = z.infer<typeof targetSchema>;

const SkillList: Skill[] = [
  { id: "fishing", name: "Fishing", claimInterval: 2000 },
];
const TargetList: Target[] = [{ id: "little_pond", name: "Little pond" }];
const SkillMap = Object.fromEntries(SkillList.map((s) => [s.id, s]));
const TargetMap = Object.fromEntries(TargetList.map((t) => [t.id, t]));

/* ----------------------------- Routes ----------------------------- */

const group = new Hono();

// Start a new cast; cancels any existing one
const startSchema = z.object({
  skillId: z.string(),
  targetId: z.string(),
  // Maximum total claims for this ticket.
  // Omit => DEFAULT_CLAIM_MAX (from env), `null` => unlimited (but hard-capped by UNLIMITED_CAP).
  claimMax: z.number().int().min(1).nullable().optional(),
});

group.post("/", async (c) => {
  const nowIso = new Date().toISOString();

  const body = await c.req.json().catch(() => ({}));
  const parsed = startSchema.safeParse(body);
  if (!parsed.success) {
    return sendError(c, parsed.error.issues[0]?.message ?? "Invalid body", 400);
  }

  const { skillId, targetId } = parsed.data;
  const reqClaimMax = parsed.data.claimMax; // can be number|null|undefined

  const skill = SkillMap[skillId];
  const target = TargetMap[targetId];
  if (!skill) return sendError(c, `Unknown skill: ${skillId}`, 404);
  if (!target) return sendError(c, `Unknown target: ${targetId}`, 404);

  // Pick default from env if not provided
  const effectiveClaimMax: number | null =
    reqClaimMax === undefined ? DEFAULT_CLAIM_MAX : reqClaimMax;

  const row = await db.transaction(async (tx) => {
    await tx.update(cast).set({ endedAt: nowIso }).where(isNull(cast.endedAt));
    const [created] = await tx
      .insert(cast)
      .values({
        id: undefined,
        skill: skill.id,
        target: target.id,
        startedAt: nowIso,
        claimed: 0,
        claimMax: effectiveClaimMax, // null = unlimited (but hard-capped later)
        claimInterval: skill.claimInterval,
      })
      .returning();
    return created!;
  });

  const atMs = Date.now();
  const eta = nextEta(row, atMs);

  return c.json(
    {
      data: {
        id: row.id,
        location: `/cast`,
        eta,
        claimed: row.claimed,
        claimMax: row.claimMax,
        claimInterval: row.claimInterval,
        startedAt: row.startedAt,
        unlimited: row.claimMax == null,
        unlimitedCap: UNLIMITED_CAP,
      },
    },
    201,
  );
});

// Cancel current cast
group.delete("/", async (c) => {
  await db
    .update(cast)
    .set({ endedAt: new Date().toISOString() })
    .where(isNull(cast.endedAt));
  return c.json({ data: null }, 200);
});

// Claim ready ticks (default claim-all). Optional ?limit=N
group.post("/claim", async (c) => {
  const row = await getActive();
  if (!row)
    return c.json(
      {
        data: {
          status: "stopped",
        },
      },
      200,
    );

  const atMs = Date.now();
  const available = availableRuns(row, atMs);

  if (available === 0) {
    const eta = nextEta(row, atMs);
    const remaining =
      row.claimMax == null
        ? Math.max(0, UNLIMITED_CAP - row.claimed)
        : Math.max(0, maxRuns(row) - row.claimed);
    return c.json(
      {
        data: {
          id: row.id,
          taken: 0,
          totalClaimed: row.claimed,
          remaining,
          eta,
          status: "paused",
        },
      },
      200,
    );
  }

  const limitParam = Number(c.req.query("limit"));
  const requested = Number.isFinite(limitParam)
    ? Math.max(1, Math.floor(limitParam))
    : available;
  const take = clamp(requested, 1, available);

  const [updated] = await db
    .update(cast)
    .set({ claimed: sql`${cast.claimed} + ${take}` })
    .where(and(eq(cast.id, row.id), eq(cast.claimed, row.claimed)))
    .returning();

  if (!updated) return sendError(c, "conflict, retry", 409);

  const remaining =
    updated.claimMax == null
      ? Math.max(0, UNLIMITED_CAP - updated.claimed)
      : Math.max(0, maxRuns(updated) - updated.claimed);

  const eta = nextEta(updated, Date.now());

  return c.json(
    {
      data: {
        id: updated.id,
        taken: take,
        totalClaimed: updated.claimed,
        remaining,
        eta,
        status: "ok",
      },
    },
    200,
  );
});

export default group;
