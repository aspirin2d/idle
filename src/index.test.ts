import { describe, it, expect, vi, beforeEach } from "vitest";

const serveMock = vi.fn();
const ensureDefaultScheduleMock = vi.fn();
const ensureDefaultIdleTaskMock = vi.fn();

/** Helpers to build no-op query chains that look like Drizzle */
function makeSelectChain() {
  const where = vi.fn().mockResolvedValue([]); // await db.select(...).from(...).where(...)
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { select, from, where };
}

function makeInsertChain() {
  const returning = vi.fn().mockResolvedValue([]); // await ...returning()
  const onConflictDoUpdate = vi.fn().mockResolvedValue([]); // await ...onConflictDoUpdate(...)
  const values = vi.fn().mockReturnValue({ returning, onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });
  return { insert, values, returning, onConflictDoUpdate };
}

function makeUpdateChain() {
  const returning = vi.fn().mockResolvedValue([]);
  const where = vi.fn().mockReturnValue({ returning }); // await ...where(...).returning()
  const set = vi.fn().mockReturnValue({ where });
  const update = vi.fn().mockReturnValue({ set });
  return { update, set, where, returning };
}

function makeDeleteChain() {
  const returning = vi.fn().mockResolvedValue([]); // some callers use returning()
  const where = vi.fn().mockResolvedValue([]); // others just await where(...)
  const del = vi.fn().mockReturnValue({ where, returning });
  return { del, where, returning };
}

/** Build a db mock that supports all common chains */
function createDbMock() {
  const { select } = makeSelectChain();
  const { insert } = makeInsertChain();
  const { update } = makeUpdateChain();
  const { del } = makeDeleteChain();

  // optional: a transaction that just runs the callback with a new db stub
  const transaction = vi.fn(async (cb: any) => cb(createDbMock() as never));

  return {
    select,
    insert,
    update,
    delete: del,
    transaction,
  };
}

const dbMock = createDbMock();

vi.mock("@hono/node-server", () => ({ serve: serveMock }));

vi.mock("./db/index.js", () => ({
  __esModule: true,
  ensureDefaultSchedule: ensureDefaultScheduleMock,
  ensureDefaultIdleTask: ensureDefaultIdleTaskMock,
  default: dbMock,
}));

// (optional but recommended) avoid file I/O during this test run
const ensureSkillTargetDefsSyncedOnStartMock = vi.fn();
vi.mock("./lib/skill-targets.js", () => ({
  __esModule: true,
  ensureSkillTargetDefsSyncedOnStart: ensureSkillTargetDefsSyncedOnStartMock,
}));

const ensureItemDefsSyncedOnStartMock = vi.fn();
vi.mock("./lib/items.js", () => ({
  __esModule: true,
  ensureItemDefsSyncedOnStart: ensureItemDefsSyncedOnStartMock,
}));

describe("index", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    serveMock.mockReset();
    ensureDefaultScheduleMock.mockReset();
    ensureDefaultIdleTaskMock.mockReset();
    ensureSkillTargetDefsSyncedOnStartMock.mockReset();
    ensureItemDefsSyncedOnStartMock.mockReset();
    delete process.env.PORT;
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("respects PORT environment variable", async () => {
    process.env.PORT = "4321";
    await import("./index.js");
    const [opts, cb] = serveMock.mock.calls[0];
    expect(opts.port).toBe(4321);
    cb({ port: opts.port });
    expect(console.log).toHaveBeenCalledWith(
      `Server is running on http://localhost:${opts.port}`,
    );
    expect(ensureDefaultScheduleMock).toHaveBeenCalled();
    expect(ensureDefaultIdleTaskMock).toHaveBeenCalled();
    // optional: also assert these were invoked
    expect(ensureItemDefsSyncedOnStartMock).toHaveBeenCalled();
    expect(ensureSkillTargetDefsSyncedOnStartMock).toHaveBeenCalled();
  });

  it("falls back to the default port when PORT is unset", async () => {
    await import("./index.js");
    const [opts] = serveMock.mock.calls[0];
    expect(opts.port).toBe(3000);
    expect(ensureDefaultScheduleMock).toHaveBeenCalled();
    expect(ensureDefaultIdleTaskMock).toHaveBeenCalled();
  });
});
