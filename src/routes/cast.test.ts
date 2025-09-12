import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { isNull } from "drizzle-orm";
import { cast } from "../db/schema.js";

let app: Hono;
let db: any;

beforeAll(async () => {
  process.env.PG_DATA = "memory://test";
  ({ default: db } = await import("../db/index.js"));
  await db.$client.exec(`CREATE TABLE "cast" (
    id text PRIMARY KEY,
    skill_id text NOT NULL,
    target_id text NOT NULL,
    started_at timestamptz NOT NULL,
    claimed integer NOT NULL DEFAULT 0,
    claim_max integer,
    claim_interval integer NOT NULL,
    ended_at timestamptz
  );`);
  const castModule = await import("./cast.js");
  app = new Hono().route("/cast", castModule.default);
});

beforeEach(async () => {
  await db.$client.exec('DELETE FROM "cast";');
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

  describe("cast router", () => {
    it("returns structured error when no cast active", async () => {
      const res = await app.request("/cast");
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.message).toBe("no active cast");
    });

  it("starts a new cast and returns eta", async () => {
    const res = await app.request("/cast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillId: "fishing", targetId: "little_pond" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.eta).toBe(2000);
  });

  it("suspends existing cast instead of deleting", async () => {
    const payload = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillId: "fishing", targetId: "little_pond" }),
    };

    await app.request("/cast", payload);
    await app.request("/cast", payload);

    const all = await db.select().from(cast);
    expect(all.length).toBe(2);

    const active = await db.select().from(cast).where(isNull(cast.endedAt));
    expect(active.length).toBe(1);
  });

  it("allows claiming after interval", async () => {
    await app.request("/cast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillId: "fishing", targetId: "little_pond" }),
    });

    let res = await app.request("/cast/claim", { method: "POST" });
    expect(res.status).toBe(202);
    let json = await res.json();
    expect(json.data.taken).toBe(0);

    vi.setSystemTime(new Date("2024-01-01T00:00:02Z"));

    res = await app.request("/cast/claim", { method: "POST" });
    expect(res.status).toBe(200);
    json = await res.json();
    expect(json.data.taken).toBe(1);
    expect(json.data.remaining).toBe(0);
  });
});
