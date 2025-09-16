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

type SkillTargetsModule = typeof import("./skill-targets.js");
let skillTargets: SkillTargetsModule;

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

describe("skill target library", () => {
  beforeEach(async () => {
    vi.resetModules();
    readFileMock.mockReset();
    selectMock.mockReset();
    insertMock.mockReset();
    deleteMock.mockReset();
    skillTargets = await import("./skill-targets.js");
  });

  afterEach(() => {
    delete process.env.SKILL_TARGET_DEFS_PATH;
    delete process.env.SKILL_TARGET_DEFS_OPTIONAL;
    delete process.env.SKILL_TARGET_DEFS_PRUNE;
    vi.restoreAllMocks();
  });

  it("normalizes both array and wrapped file formats", () => {
    const { parseSkillTargetDefs } = skillTargets;

    const arrayResult = parseSkillTargetDefs([
      { id: "target-1", name: "Target One" },
    ]);
    expect(arrayResult).toEqual([
      {
        id: "target-1",
        name: "Target One",
        requirements: {},
        metadata: {},
      },
    ]);

    const wrappedResult = parseSkillTargetDefs({
      targets: [
        {
          id: "target-2",
          name: "Target Two",
          requirements: { skill: "digging" },
          metadata: { difficulty: "hard" },
        },
      ],
    });
    expect(wrappedResult).toEqual([
      {
        id: "target-2",
        name: "Target Two",
        requirements: { skill: "digging" },
        metadata: { difficulty: "hard" },
      },
    ]);
  });

  it("rejects invalid skill target definitions", () => {
    const { parseSkillTargetDefs } = skillTargets;
    expect(() => parseSkillTargetDefs({})).toThrowError(/Invalid input/);
  });

  it("maps parsed skill targets to database insert payload", () => {
    const { toNewSkillTargetDef } = skillTargets;
    const parsed = {
      id: "target-3",
      name: "Target Three",
      requirements: { minLevel: 2 },
      metadata: { zone: "asteroid" },
    };

    expect(toNewSkillTargetDef(parsed)).toEqual({
      id: "target-3",
      name: "Target Three",
      requirements: { minLevel: 2 },
      metadata: { zone: "asteroid" },
    });
  });

  it("loads skill target definitions from a file", async () => {
    const { loadSkillTargetDefsFromFile } = skillTargets;
    readFileMock.mockResolvedValueOnce(
      JSON.stringify([{ id: "target-4", name: "Target Four" }]),
    );

    const defs = await loadSkillTargetDefsFromFile("/tmp/skill-targets.json");
    expect(defs).toEqual([
      {
        id: "target-4",
        name: "Target Four",
        requirements: {},
        metadata: {},
      },
    ]);
    expect(readFileMock).toHaveBeenCalledWith("/tmp/skill-targets.json", "utf8");
  });

  it("short-circuits syncing when there are no skill targets", async () => {
    const { syncSkillTargetDefsFromFile } = skillTargets;
    readFileMock.mockResolvedValueOnce(JSON.stringify([]));

    const result = await syncSkillTargetDefsFromFile("/tmp/skill-targets.json");
    expect(result).toEqual({ inserted: 0, updated: 0, pruned: 0, total: 0 });
    expect(selectMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("computes inserted and updated counts in dry-run mode", async () => {
    const { syncSkillTargetDefsFromFile } = skillTargets;
    readFileMock.mockResolvedValueOnce(
      JSON.stringify([
        { id: "existing", name: "Existing" },
        { id: "new", name: "New" },
      ]),
    );

    mockSelect([{ id: "existing" }]);

    const result = await syncSkillTargetDefsFromFile("/tmp/skill-targets.json", {
      dryRun: true,
    });
    expect(result).toEqual({ inserted: 1, updated: 1, pruned: 0, total: 2 });
    expect(insertMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("upserts skill targets and prunes missing ones when requested", async () => {
    const { syncSkillTargetDefsFromFile } = skillTargets;
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

    const result = await syncSkillTargetDefsFromFile("/tmp/skill-targets.json", {
      prune: true,
    });

    expect(result).toEqual({ inserted: 1, updated: 1, pruned: 1, total: 2 });
    expect(values).toHaveBeenCalledTimes(1);
    expect(values.mock.calls[0][0]).toEqual([
      {
        id: "existing",
        name: "Existing",
        requirements: {},
        metadata: {},
      },
      {
        id: "new",
        name: "New",
        requirements: {},
        metadata: {},
      },
    ]);
    expect(onConflictDoUpdate).toHaveBeenCalledWith({
      target: expect.anything(),
      set: expect.objectContaining({
        name: expect.anything(),
        requirements: expect.anything(),
        metadata: expect.anything(),
        updatedAt: expect.any(Date),
      }),
    });
    expect(deleteWhere).toHaveBeenCalledTimes(1);
  });

  it("logs sync results during startup", async () => {
    const { ensureSkillTargetDefsSyncedOnStart } = skillTargets;
    readFileMock.mockResolvedValueOnce(
      JSON.stringify([{ id: "startup", name: "Startup" }]),
    );
    mockSelect([]);
    const { values } = mockInsert();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await ensureSkillTargetDefsSyncedOnStart();

    expect(values).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(
      "[skill-targets] synced 1 defs (inserted: 1, updated: 0) from ./data/skill-targets.json",
    );
  });

  it("optionally suppresses missing definition files", async () => {
    const { ensureSkillTargetDefsSyncedOnStart } = skillTargets;
    process.env.SKILL_TARGET_DEFS_PATH = "./missing.json";
    process.env.SKILL_TARGET_DEFS_OPTIONAL = "true";

    const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
    readFileMock.mockRejectedValueOnce(missing);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(ensureSkillTargetDefsSyncedOnStart()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      "[skill-targets] defs file not found at ./missing.json; skipping.",
    );
  });

  it("rethrows non-optional missing files with guidance", async () => {
    const { ensureSkillTargetDefsSyncedOnStart } = skillTargets;
    process.env.SKILL_TARGET_DEFS_PATH = "./missing.json";
    const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
    readFileMock.mockRejectedValueOnce(missing);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(ensureSkillTargetDefsSyncedOnStart()).rejects.toThrow("missing");
    expect(warnSpy).toHaveBeenCalledWith(
      "[skill-targets] defs file not found at ./missing.json. Set SKILL_TARGET_DEFS_OPTIONAL=true to skip.",
    );
  });
});
