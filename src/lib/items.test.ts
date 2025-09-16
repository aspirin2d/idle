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

type ItemsModule = typeof import("./items.js");
let items: ItemsModule;

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

describe("items library", () => {
  beforeEach(async () => {
    vi.resetModules();
    readFileMock.mockReset();
    selectMock.mockReset();
    insertMock.mockReset();
    deleteMock.mockReset();
    items = await import("./items.js");
  });

  afterEach(() => {
    delete process.env.ITEM_DEFS_PATH;
    delete process.env.ITEM_DEFS_OPTIONAL;
    delete process.env.ITEM_DEFS_PRUNE;
    vi.restoreAllMocks();
  });

  it("normalizes both array and wrapped file formats", () => {
    const { parseItemDefs } = items;

    const arrayResult = parseItemDefs([
      { id: "iron", name: "Iron", category: "material" as const },
    ]);
    expect(arrayResult).toEqual([
      {
        id: "iron",
        name: "Iron",
        category: "material",
        stack: { max: 1 },
        weight: 0,
        metadata: {},
      },
    ]);

    const wrappedResult = parseItemDefs({
      items: [
        {
          id: "berry",
          name: "Berry",
          category: "consumable",
          stack: { max: 10, default: 5 },
          weight: 2,
          metadata: { rarity: "common" },
        },
      ],
    });
    expect(wrappedResult).toEqual([
      {
        id: "berry",
        name: "Berry",
        category: "consumable",
        stack: { max: 10, default: 5 },
        weight: 2,
        metadata: { rarity: "common" },
      },
    ]);
  });

  it("rejects invalid item definitions", () => {
    const { parseItemDefs } = items;
    expect(() => parseItemDefs({})).toThrowError(/Invalid input/);
  });

  it("maps parsed items to database insert payload", () => {
    const { toNewItemDef } = items;
    const parsed = {
      id: "ingot",
      name: "Copper Ingot",
      category: "material" as const,
      stack: { max: 50 },
      weight: 1,
      metadata: { grade: "refined" },
    };

    expect(toNewItemDef(parsed)).toEqual({
      id: "ingot",
      name: "Copper Ingot",
      category: "material",
      stackMax: 50,
      weight: 1,
      metadata: { grade: "refined" },
    });
  });

  it("loads item definitions from a file", async () => {
    const { loadItemDefsFromFile } = items;
    readFileMock.mockResolvedValueOnce(
      JSON.stringify([{ id: "wood", name: "Wood", category: "material" }]),
    );

    const defs = await loadItemDefsFromFile("/tmp/items.json");
    expect(defs).toEqual([
      {
        id: "wood",
        name: "Wood",
        category: "material",
        stack: { max: 1 },
        weight: 0,
        metadata: {},
      },
    ]);
    expect(readFileMock).toHaveBeenCalledWith("/tmp/items.json", "utf8");
  });

  it("short-circuits syncing when there are no item definitions", async () => {
    const { syncItemDefsFromFile } = items;
    readFileMock.mockResolvedValueOnce(JSON.stringify([]));

    const result = await syncItemDefsFromFile("/tmp/items.json");
    expect(result).toEqual({ inserted: 0, updated: 0, pruned: 0, total: 0 });
    expect(selectMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("computes inserted and updated counts in dry-run mode", async () => {
    const { syncItemDefsFromFile } = items;
    readFileMock.mockResolvedValueOnce(
      JSON.stringify([
        { id: "existing", name: "Existing", category: "material" },
        { id: "new", name: "New", category: "material" },
      ]),
    );

    mockSelect([{ id: "existing" }]);

    const result = await syncItemDefsFromFile("/tmp/items.json", { dryRun: true });
    expect(result).toEqual({ inserted: 1, updated: 1, pruned: 0, total: 2 });
    expect(insertMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("upserts items and prunes missing ones when requested", async () => {
    const { syncItemDefsFromFile } = items;
    readFileMock.mockResolvedValueOnce(
      JSON.stringify([
        { id: "existing", name: "Existing", category: "material" },
        { id: "new", name: "New", category: "consumable" },
      ]),
    );

    mockSelect([{ id: "existing" }]);
    mockSelect([{ id: "existing" }, { id: "legacy" }], { raw: true });
    const { values, onConflictDoUpdate } = mockInsert();
    const { where: deleteWhere } = mockDelete();

    const result = await syncItemDefsFromFile("/tmp/items.json", { prune: true });

    expect(result).toEqual({ inserted: 1, updated: 1, pruned: 1, total: 2 });
    expect(values).toHaveBeenCalledTimes(1);
    expect(values.mock.calls[0][0]).toEqual([
      {
        id: "existing",
        name: "Existing",
        category: "material",
        stackMax: 1,
        weight: 0,
        metadata: {},
      },
      {
        id: "new",
        name: "New",
        category: "consumable",
        stackMax: 1,
        weight: 0,
        metadata: {},
      },
    ]);
    expect(onConflictDoUpdate).toHaveBeenCalledWith({
      target: expect.anything(),
      set: expect.objectContaining({
        name: expect.anything(),
        category: expect.anything(),
        stackMax: expect.anything(),
        weight: expect.anything(),
        metadata: expect.anything(),
        updatedAt: expect.any(Date),
      }),
    });
    expect(deleteWhere).toHaveBeenCalledTimes(1);
  });

  it("logs sync results during startup", async () => {
    const { ensureItemDefsSyncedOnStart } = items;
    readFileMock.mockResolvedValueOnce(
      JSON.stringify([{ id: "startup", name: "Startup", category: "material" }]),
    );
    mockSelect([]);
    const { values } = mockInsert();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await ensureItemDefsSyncedOnStart();

    expect(values).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(
      "[items] synced 1 defs (inserted: 1, updated: 0) from ./data/items.json",
    );
  });

  it("optionally suppresses missing definition files", async () => {
    const { ensureItemDefsSyncedOnStart } = items;
    process.env.ITEM_DEFS_PATH = "./missing.json";
    process.env.ITEM_DEFS_OPTIONAL = "true";

    const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
    readFileMock.mockRejectedValueOnce(missing);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(ensureItemDefsSyncedOnStart()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      "[items] item defs file not found at ./missing.json; skipping.",
    );
  });

  it("rethrows non-optional missing files with guidance", async () => {
    const { ensureItemDefsSyncedOnStart } = items;
    process.env.ITEM_DEFS_PATH = "./missing.json";
    const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
    readFileMock.mockRejectedValueOnce(missing);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(ensureItemDefsSyncedOnStart()).rejects.toThrow("missing");
    expect(warnSpy).toHaveBeenCalledWith(
      "[items] item defs file not found at ./missing.json. Set ITEM_DEFS_OPTIONAL=true to skip.",
    );
  });
});
