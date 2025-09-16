import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readFileMock = vi.fn();
const selectMock = vi.fn();
const insertMock = vi.fn();
const deleteMock = vi.fn();

vi.mock("node:fs/promises", () => ({
  readFile: readFileMock,
}));

vi.mock("../db/index.js", () => ({
  __esModule: true,
  default: {
    select: selectMock,
    insert: insertMock,
    delete: deleteMock,
  },
}));

type SkillsModule = typeof import("./skills.js");
let skills: SkillsModule;

function mockSelect(result: unknown, opts: { raw?: boolean } = {}) {
  if (opts.raw) {
    const from = vi.fn().mockResolvedValue(result);
    selectMock.mockReturnValueOnce({ from });
    return { from };
  }

  const where = vi.fn().mockResolvedValue(result);
  const from = vi.fn().mockReturnValue({ where });
  selectMock.mockReturnValueOnce({ from });
  return { from, where };
}

function mockDelete(result: unknown = undefined) {
  const where = vi.fn().mockResolvedValue(result);
  deleteMock.mockReturnValueOnce({ where });
  return { where };
}

function mockInsert() {
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  insertMock.mockReturnValueOnce({ values });
  return { values, onConflictDoUpdate };
}

describe("skills library", () => {
  beforeEach(async () => {
    vi.resetModules();
    readFileMock.mockReset();
    selectMock.mockReset();
    insertMock.mockReset();
    deleteMock.mockReset();
    skills = await import("./skills.js");
  });

  afterEach(() => {
    delete process.env.SKILL_DEFS_PATH;
    delete process.env.SKILL_DEFS_OPTIONAL;
    delete process.env.SKILL_DEFS_PRUNE;
    vi.restoreAllMocks();
  });

  it("normalizes both array and wrapped file formats", () => {
    const { parseSkillDefs } = skills;

    const arrayResult = parseSkillDefs([
      { id: "mining", name: "Mining", priority: 1 },
    ]);
    expect(arrayResult).toEqual([
      {
        id: "mining",
        name: "Mining",
        priority: 1,
        requirements: {},
        metadata: {},
      },
    ]);

    const wrappedResult = parseSkillDefs({
      skills: [
        {
          id: "research",
          name: "Research",
          priority: 3,
          requirements: { tier: 2 },
          metadata: { category: "science" },
        },
      ],
    });
    expect(wrappedResult).toEqual([
      {
        id: "research",
        name: "Research",
        priority: 3,
        requirements: { tier: 2 },
        metadata: { category: "science" },
      },
    ]);
  });

  it("rejects invalid skill definitions", () => {
    const { parseSkillDefs } = skills;
    expect(() => parseSkillDefs({})).toThrowError(/Invalid input/);
  });

  it("maps parsed skills to database insert payload", () => {
    const { toNewSkillDef } = skills;
    const parsed = {
      id: "cooking",
      name: "Cooking",
      priority: 2,
      requirements: { heat: true },
      metadata: { station: "stove" },
    };

    expect(toNewSkillDef(parsed)).toEqual({
      id: "cooking",
      name: "Cooking",
      priority: 2,
      requirements: { heat: true },
      metadata: { station: "stove" },
    });
  });

  it("loads skill definitions from a file", async () => {
    const { loadSkillDefsFromFile } = skills;
    readFileMock.mockResolvedValueOnce(
      JSON.stringify([{ id: "art", name: "Art" }]),
    );

    const defs = await loadSkillDefsFromFile("/tmp/skills.json");
    expect(defs).toEqual([
      {
        id: "art",
        name: "Art",
        priority: 0,
        requirements: {},
        metadata: {},
      },
    ]);
    expect(readFileMock).toHaveBeenCalledWith("/tmp/skills.json", "utf8");
  });

  it("short-circuits syncing when there are no skill definitions", async () => {
    const { syncSkillDefsFromFile } = skills;
    readFileMock.mockResolvedValueOnce(JSON.stringify([]));

    const result = await syncSkillDefsFromFile("/tmp/skills.json");
    expect(result).toEqual({ inserted: 0, updated: 0, pruned: 0, total: 0 });
    expect(selectMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("computes inserted and updated counts in dry-run mode", async () => {
    const { syncSkillDefsFromFile } = skills;
    readFileMock.mockResolvedValueOnce(
      JSON.stringify([
        { id: "existing", name: "Existing" },
        { id: "new", name: "New" },
      ]),
    );

    mockSelect([{ id: "existing" }]);

    const result = await syncSkillDefsFromFile("/tmp/skills.json", { dryRun: true });
    expect(result).toEqual({ inserted: 1, updated: 1, pruned: 0, total: 2 });
    expect(insertMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("upserts skills and prunes missing ones when requested", async () => {
    const { syncSkillDefsFromFile } = skills;
    readFileMock.mockResolvedValueOnce(
      JSON.stringify([
        { id: "existing", name: "Existing" },
        { id: "new", name: "New" },
      ]),
    );

    mockSelect([{ id: "existing" }]);
    mockSelect([{ id: "existing" }, { id: "legacy" }], { raw: true });
    const { values, onConflictDoUpdate } = mockInsert();
    const { where: deleteWhere } = mockDelete();

    const result = await syncSkillDefsFromFile("/tmp/skills.json", { prune: true });

    expect(result).toEqual({ inserted: 1, updated: 1, pruned: 1, total: 2 });
    expect(values).toHaveBeenCalledTimes(1);
    expect(values.mock.calls[0][0]).toEqual([
      {
        id: "existing",
        name: "Existing",
        priority: 0,
        requirements: {},
        metadata: {},
      },
      {
        id: "new",
        name: "New",
        priority: 0,
        requirements: {},
        metadata: {},
      },
    ]);
    expect(onConflictDoUpdate).toHaveBeenCalledWith({
      target: expect.anything(),
      set: expect.objectContaining({
        name: expect.anything(),
        priority: expect.anything(),
        requirements: expect.anything(),
        metadata: expect.anything(),
        updatedAt: expect.any(Date),
      }),
    });
    expect(deleteWhere).toHaveBeenCalledTimes(1);
  });

  it("logs sync results during startup", async () => {
    const { ensureSkillDefsSyncedOnStart } = skills;
    readFileMock.mockResolvedValueOnce(
      JSON.stringify([{ id: "startup", name: "Startup" }]),
    );
    mockSelect([]);
    const { values } = mockInsert();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await ensureSkillDefsSyncedOnStart();

    expect(values).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(
      "[skills] synced 1 defs (inserted: 1, updated: 0) from ./data/skills.json",
    );
  });

  it("optionally suppresses missing definition files", async () => {
    const { ensureSkillDefsSyncedOnStart } = skills;
    process.env.SKILL_DEFS_PATH = "./missing.json";
    process.env.SKILL_DEFS_OPTIONAL = "true";

    const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
    readFileMock.mockRejectedValueOnce(missing);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(ensureSkillDefsSyncedOnStart()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      "[skills] skill defs file not found at ./missing.json; skipping.",
    );
  });

  it("rethrows non-optional missing files with guidance", async () => {
    const { ensureSkillDefsSyncedOnStart } = skills;
    process.env.SKILL_DEFS_PATH = "./missing.json";
    const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
    readFileMock.mockRejectedValueOnce(missing);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(ensureSkillDefsSyncedOnStart()).rejects.toThrow("missing");
    expect(warnSpy).toHaveBeenCalledWith(
      "[skills] skill defs file not found at ./missing.json. Set SKILL_DEFS_OPTIONAL=true to skip.",
    );
  });
});
