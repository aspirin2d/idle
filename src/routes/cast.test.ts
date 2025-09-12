import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { isNull } from "drizzle-orm";
import { cast } from "../db/schema.js";

let app: Hono;
let db: any;

async function buildApp() {
  ({ default: db } = await import("../db/index.js"));
  await db.$client.exec(`CREATE TABLE IF NOT EXISTS "cast" (
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
}

beforeAll(async () => {
  process.env.PG_DATA = "memory://test";
  await buildApp();
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

  it("rejects invalid body", async () => {
    const res = await app.request("/cast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("rejects unknown skill", async () => {
    const res = await app.request("/cast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillId: "nope", targetId: "little_pond" }),
    });
    expect(res.status).toBe(404);
  });

  it("rejects unknown target", async () => {
    const res = await app.request("/cast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillId: "fishing", targetId: "nowhere" }),
    });
    expect(res.status).toBe(404);
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

  it("cancels current cast", async () => {
    const payload = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillId: "fishing", targetId: "little_pond" }),
    };
    await app.request("/cast", payload);

    let res = await app.request("/cast", { method: "DELETE" });
    expect(res.status).toBe(200);

    res = await app.request("/cast");
    expect(res.status).toBe(404);
  });

  it("polls with retry info when not ready", async () => {
    await app.request("/cast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillId: "fishing", targetId: "little_pond" }),
    });

    const res = await app.request("/cast");
    expect(res.status).toBe(202);
    expect(res.headers.get("retry-after")).toBe("2");
    expect(res.headers.get("x-retry-after-ms")).toBe("2000");
    expect(res.headers.get("etag")).toBeTruthy();
  });

  it("returns 304 when ETag matches", async () => {
    await app.request("/cast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillId: "fishing", targetId: "little_pond" }),
    });
    const first = await app.request("/cast");
    const tag = first.headers.get("etag")!;
    const res = await app.request("/cast", { headers: { "If-None-Match": tag } });
    expect(res.status).toBe(304);
  });

  it("waits when Prefer wait is supplied", async () => {
    await app.request("/cast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillId: "fishing", targetId: "little_pond" }),
    });

    const promise = app.request("/cast", { headers: { Prefer: "wait=5000" } });
    await vi.advanceTimersByTimeAsync(2000);
    const res = await promise;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.available).toBe(1);
  });

  it("allows claiming after interval", async () => {
    await app.request("/cast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillId: "fishing", targetId: "little_pond" }),
    });

    let res = await app.request("/cast/claim", { method: "POST" });
    expect(res.status).toBe(202);

    vi.setSystemTime(new Date("2024-01-01T00:00:02Z"));

    res = await app.request("/cast/claim", { method: "POST" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.taken).toBe(1);
    expect(json.data.remaining).toBe(0);
  });

  it("clamps claim limit high and low", async () => {
    await app.request("/cast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        skillId: "fishing",
        targetId: "little_pond",
        claimMax: 5,
      }),
    });

    vi.setSystemTime(new Date("2024-01-01T00:00:04Z"));
    let res = await app.request("/cast/claim?limit=5", { method: "POST" });
    let json = await res.json();
    expect(json.data.taken).toBe(2);

    vi.setSystemTime(new Date("2024-01-01T00:00:06Z"));
    res = await app.request("/cast/claim?limit=0", { method: "POST" });
    json = await res.json();
    expect(json.data.taken).toBe(1);
  });

  it("supports unlimited casts", async () => {
    await app.request("/cast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        skillId: "fishing",
        targetId: "little_pond",
        claimMax: null,
      }),
    });

    vi.setSystemTime(new Date("2024-01-01T00:00:04Z"));
    const res = await app.request("/cast/claim", { method: "POST" });
    const json = await res.json();
    expect(json.data.remaining).toBe(998);
  });

  it("returns 409 on concurrent claim", async () => {
    await app.request("/cast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillId: "fishing", targetId: "little_pond" }),
    });

    vi.setSystemTime(new Date("2024-01-01T00:00:02Z"));

    const spy = vi
      .spyOn(db, "update")
      .mockReturnValueOnce({
        set: () => ({
          where: () => ({
            returning: async () => [],
          }),
        }),
      } as any);

    const res = await app.request("/cast/claim", { method: "POST" });
    expect(res.status).toBe(409);
    spy.mockRestore();
  });

  it("claim returns 404 when no active cast", async () => {
    const res = await app.request("/cast/claim", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("indicates finished when max reached", async () => {
    await app.request("/cast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        skillId: "fishing",
        targetId: "little_pond",
        claimMax: 1,
      }),
    });

    vi.setSystemTime(new Date("2024-01-01T00:00:02Z"));
    await app.request("/cast/claim", { method: "POST" });
    vi.setSystemTime(new Date("2024-01-01T00:00:04Z"));

    const res = await app.request("/cast");
    const json = await res.json();
    expect(json.data.finished).toBe(true);
  });
});

describe("CAST_DEFAULT_CLAIM_MAX", () => {
  async function createWithEnv(value: string) {
    vi.resetModules();
    process.env.PG_DATA = "memory://" + Math.random().toString(36).slice(2);
    process.env.CAST_DEFAULT_CLAIM_MAX = value;
    const { default: db } = await import("../db/index.js");
    await db.$client.exec(`CREATE TABLE IF NOT EXISTS "cast" (
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
    const app = new Hono().route("/cast", castModule.default);
    return { app };
  }

  afterEach(() => {
    delete process.env.CAST_DEFAULT_CLAIM_MAX;
  });

  it("treats 'unlimited' as null", async () => {
    const { app } = await createWithEnv("unlimited");
    const res = await app.request("/cast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillId: "fishing", targetId: "little_pond" }),
    });
    const json = await res.json();
    expect(json.data.unlimited).toBe(true);
  });

  it("uses numeric default", async () => {
    const { app } = await createWithEnv("5");
    const res = await app.request("/cast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillId: "fishing", targetId: "little_pond" }),
    });
    const json = await res.json();
    expect(json.data.claimMax).toBe(5);
  });

  it("falls back to 1 on invalid default", async () => {
    const { app } = await createWithEnv("0");
    const res = await app.request("/cast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillId: "fishing", targetId: "little_pond" }),
    });
    const json = await res.json();
    expect(json.data.claimMax).toBe(1);
  });
});
