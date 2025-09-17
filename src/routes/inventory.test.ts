import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { eq } from "drizzle-orm";

import { createInventoryRoutes } from "./inventory.js";
import { createTestDatabase, type TestDatabase } from "../test-utils/db.js";
import {
  duplicant,
  inventory,
  itemDef,
  schedule,
  stats,
  task,
} from "../db/schema.js";
import {
  DEFAULT_IDLE_TASK_ID,
  DEFAULT_SCHEDULE_ACTIVITIES,
  DEFAULT_SCHEDULE_ID,
} from "../db/index.js";

describe("inventory routes (integration)", () => {
  let testDb: TestDatabase;
  let duplicantId: string;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  });

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(async () => {
    await testDb.reset();

    await testDb.db.insert(schedule).values({
      id: DEFAULT_SCHEDULE_ID,
      activities: DEFAULT_SCHEDULE_ACTIVITIES,
    });
    await testDb.db.insert(task).values({
      id: DEFAULT_IDLE_TASK_ID,
      description: "Idle",
      skillId: "idle",
      targetId: null,
    });

    const [statsRow] = await testDb.db
      .insert(stats)
      .values({ stamina: 100, calories: 4000, bladder: 0 })
      .returning();

    const [dupRow] = await testDb.db
      .insert(duplicant)
      .values({
        name: "Ada",
        taskId: DEFAULT_IDLE_TASK_ID,
        scheduleId: DEFAULT_SCHEDULE_ID,
        statsId: statsRow!.id,
      })
      .returning();

    duplicantId = dupRow!.id;

    await testDb.db
      .update(stats)
      .set({ duplicantId })
      .where(eq(stats.id, statsRow!.id));

    await testDb.db.insert(itemDef).values({
      id: "item-1",
      name: "Copper",
      category: "material",
      stackMax: 10,
      weight: 1,
      data: {},
      metadata: {},
    });
    await testDb.db.insert(itemDef).values({
      id: "item-2",
      name: "Iron",
      category: "material",
      stackMax: 5,
      weight: 1,
      data: {},
      metadata: {},
    });
  });

  it("validates duplicant query parameter when listing", async () => {
    const routes = createInventoryRoutes(testDb.db);
    const res = await routes.request("/");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Missing 'duplicant' query param",
    });
  });

  it("lists inventory stacks for a duplicant", async () => {
    await testDb.db.insert(inventory).values({
      duplicantId,
      slot: 0,
      itemId: "item-1",
      qty: 2,
    });

    const routes = createInventoryRoutes(testDb.db);
    const res = await routes.request(`/?duplicant=${duplicantId}`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([
      expect.objectContaining({
        duplicantId,
        slot: 0,
        itemId: "item-1",
        qty: 2,
      }),
    ]);
  });

  it("returns non-array driver results unchanged", async () => {
    const database = createMockDb();
    const where = vi.fn().mockResolvedValue({ data: "raw" });
    const from = vi.fn().mockReturnValue({ where });
    database.select.mockReturnValueOnce({ from });

    const routes = createInventoryRoutes(database as never);
    const res = await routes.request("/?duplicant=dup-1");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: "raw" });
  });

  it("fetches a stack by id", async () => {
    const [stack] = await testDb.db
      .insert(inventory)
      .values({ duplicantId, slot: 1, itemId: "item-1", qty: 1 })
      .returning();

    const routes = createInventoryRoutes(testDb.db);
    const res = await routes.request(`/${stack!.id}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: stack!.id,
      slot: 1,
      itemId: "item-1",
    });
  });

  it("creates a stack in an empty slot", async () => {
    const routes = createInventoryRoutes(testDb.db);
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({
        duplicant: duplicantId,
        slot: 0,
        item: "item-1",
        qty: 3,
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({
      duplicantId,
      slot: 0,
      itemId: "item-1",
      qty: 3,
    });
  });

  it("rejects creating a stack when qty exceeds stackMax", async () => {
    const routes = createInventoryRoutes(testDb.db);
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({
        duplicant: duplicantId,
        slot: 0,
        item: "item-2",
        qty: 6,
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "qty exceeds stackMax (5)",
    });
  });

  it("merges into an existing stack when merge is enabled", async () => {
    const [existing] = await testDb.db
      .insert(inventory)
      .values({ duplicantId, slot: 0, itemId: "item-1", qty: 4 })
      .returning();

    const routes = createInventoryRoutes(testDb.db);
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({
        duplicant: duplicantId,
        slot: existing!.slot,
        item: "item-1",
        qty: 2,
        merge: true,
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.qty).toBe(6);
  });

  it("moves a stack to an empty slot", async () => {
    const [stack] = await testDb.db
      .insert(inventory)
      .values({ duplicantId, slot: 0, itemId: "item-1", qty: 1 })
      .returning();

    const routes = createInventoryRoutes(testDb.db);
    const res = await routes.request("/move", {
      method: "POST",
      body: JSON.stringify({
        duplicant: duplicantId,
        fromSlot: 0,
        toSlot: 2,
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.action).toBe("move");
    expect(body.moved.slot).toBe(2);

    const row = await testDb.db.query.inventory.findFirst({
      where: (tbl, { eq }) => eq(tbl.id, stack!.id),
    });
    expect(row?.slot).toBe(2);
  });

  it("merges stacks during a move when possible", async () => {
    await testDb.db.insert(inventory).values({
      duplicantId,
      slot: 0,
      itemId: "item-1",
      qty: 4,
    });
    await testDb.db.insert(inventory).values({
      duplicantId,
      slot: 1,
      itemId: "item-1",
      qty: 2,
    });

    const routes = createInventoryRoutes(testDb.db);
    const res = await routes.request("/move", {
      method: "POST",
      body: JSON.stringify({
        duplicant: duplicantId,
        fromSlot: 0,
        toSlot: 1,
        merge: true,
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.action).toBe("merge_all_into_to");
    expect(body.updated.qty).toBe(6);
  });

  it("partially merges stacks when totals exceed stackMax", async () => {
    await testDb.db.insert(inventory).values({
      duplicantId,
      slot: 0,
      itemId: "item-2",
      qty: 4,
    });
    await testDb.db.insert(inventory).values({
      duplicantId,
      slot: 1,
      itemId: "item-2",
      qty: 3,
    });

    const routes = createInventoryRoutes(testDb.db);
    const res = await routes.request("/move", {
      method: "POST",
      body: JSON.stringify({
        duplicant: duplicantId,
        fromSlot: 0,
        toSlot: 1,
        merge: true,
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.action).toBe("merge_partial");
    expect(body.to.qty).toBe(5);
    expect(body.from.qty).toBe(2);
  });

  it("swaps stacks when merge is not allowed but swap is", async () => {
    await testDb.db.insert(inventory).values({
      duplicantId,
      slot: 0,
      itemId: "item-1",
      qty: 1,
    });
    await testDb.db.insert(inventory).values({
      duplicantId,
      slot: 1,
      itemId: "item-2",
      qty: 2,
    });

    const routes = createInventoryRoutes(testDb.db);
    const res = await routes.request("/move", {
      method: "POST",
      body: JSON.stringify({
        duplicant: duplicantId,
        fromSlot: 0,
        toSlot: 1,
        merge: false,
        allowSwap: true,
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.action).toBe("swap");
    expect(body.a.slot).toBe(1);
    expect(body.b.slot).toBe(0);
  });

  it("fails to move when the source slot is empty", async () => {
    const routes = createInventoryRoutes(testDb.db);
    const res = await routes.request("/move", {
      method: "POST",
      body: JSON.stringify({
        duplicant: duplicantId,
        fromSlot: 0,
        toSlot: 1,
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "No stack in fromSlot" });
  });

  it("rejects moves when the target slot is occupied without merge or swap", async () => {
    await testDb.db.insert(inventory).values({
      duplicantId,
      slot: 0,
      itemId: "item-1",
      qty: 1,
    });
    await testDb.db.insert(inventory).values({
      duplicantId,
      slot: 1,
      itemId: "item-2",
      qty: 2,
    });

    const routes = createInventoryRoutes(testDb.db);
    const res = await routes.request("/move", {
      method: "POST",
      body: JSON.stringify({
        duplicant: duplicantId,
        fromSlot: 0,
        toSlot: 1,
        merge: false,
        allowSwap: false,
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Target slot occupied and merge/swap not permitted",
    });
  });

  it("updates a stack and enforces stackMax", async () => {
    const [stack] = await testDb.db
      .insert(inventory)
      .values({ duplicantId, slot: 0, itemId: "item-2", qty: 2 })
      .returning();

    const routes = createInventoryRoutes(testDb.db);
    const res = await routes.request(`/${stack!.id}`, {
      method: "POST",
      body: JSON.stringify({ qty: 4 }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.qty).toBe(4);

    const invalidRes = await routes.request(`/${stack!.id}`, {
      method: "POST",
      body: JSON.stringify({ qty: 6 }),
      headers: { "Content-Type": "application/json" },
    });

    expect(invalidRes.status).toBe(400);
    expect(await invalidRes.json()).toEqual({
      error: "qty exceeds stackMax (5)",
    });
  });

  it("prevents slot updates when the destination is occupied", async () => {
    const [a] = await testDb.db
      .insert(inventory)
      .values({ duplicantId, slot: 0, itemId: "item-1", qty: 1 })
      .returning();
    await testDb.db.insert(inventory).values({
      duplicantId,
      slot: 1,
      itemId: "item-2",
      qty: 1,
    });

    const routes = createInventoryRoutes(testDb.db);
    const res = await routes.request(`/${a!.id}`, {
      method: "POST",
      body: JSON.stringify({ slot: 1 }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Target slot occupied. Use /inventory/move for swap/merge.",
    });
  });

  it("updates a stack slot directly when the destination is empty", async () => {
    const [stack] = await testDb.db
      .insert(inventory)
      .values({ duplicantId, slot: 0, itemId: "item-1", qty: 1 })
      .returning();

    const routes = createInventoryRoutes(testDb.db);
    const res = await routes.request(`/${stack!.id}`, {
      method: "POST",
      body: JSON.stringify({ slot: 2 }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.slot).toBe(2);

    const row = await testDb.db.query.inventory.findFirst({
      where: (tbl, { eq }) => eq(tbl.id, stack!.id),
    });
    expect(row?.slot).toBe(2);
  });

  it("deletes a stack when qty is set to 0", async () => {
    const [stack] = await testDb.db
      .insert(inventory)
      .values({ duplicantId, slot: 0, itemId: "item-1", qty: 2 })
      .returning();

    const routes = createInventoryRoutes(testDb.db);
    const res = await routes.request(`/${stack!.id}`, {
      method: "POST",
      body: JSON.stringify({ qty: 0 }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    const rows = await testDb.db.query.inventory.findMany();
    expect(rows).toHaveLength(0);
  });

  it("deletes a stack explicitly", async () => {
    const [stack] = await testDb.db
      .insert(inventory)
      .values({ duplicantId, slot: 0, itemId: "item-1", qty: 2 })
      .returning();

    const routes = createInventoryRoutes(testDb.db);
    const res = await routes.request(`/${stack!.id}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: stack!.id });
  });
});

type MockDb = {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  transaction?: ReturnType<typeof vi.fn>;
};

function createMockDb(overrides: Partial<MockDb> = {}): MockDb {
  return {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    ...overrides,
  };
}

function mockSelectWhere<T>(database: MockDb, result: T) {
  const where = vi.fn().mockResolvedValue(result);
  const from = vi.fn().mockReturnValue({ where });
  database.select.mockReturnValueOnce({ from });
  return { from, where };
}

describe("inventory routes (unit)", () => {
  it("requires the duplicant query parameter when listing stacks", async () => {
    const database = createMockDb();
    const routes = createInventoryRoutes(database as never);

    const res = await routes.request("/");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Missing 'duplicant' query param",
    });
    expect(database.select).not.toHaveBeenCalled();
  });

  it("lists inventory stacks for a duplicant", async () => {
    const database = createMockDb();
    const stacks = [
      {
        id: "stack-1",
        duplicantId: "dup-1",
        slot: 0,
        itemId: "item-1",
        qty: 2,
        durability: 90,
      },
    ];
    const { where } = mockSelectWhere(database, stacks);

    const routes = createInventoryRoutes(database as never);
    const res = await routes.request("/?duplicant=dup-1");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(stacks);
    expect(where).toHaveBeenCalledTimes(1);
  });

  it("fetches an inventory stack by id", async () => {
    const database = createMockDb();
    const stack = {
      id: "stack-42",
      duplicantId: "dup-1",
      slot: 3,
      itemId: "item-2",
      qty: 1,
      durability: 45,
    };
    const { where } = mockSelectWhere(database, [stack]);

    const routes = createInventoryRoutes(database as never);
    const res = await routes.request(`/${stack.id}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(stack);
    expect(where).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when fetching a missing inventory stack", async () => {
    const database = createMockDb();
    mockSelectWhere(database, []);

    const routes = createInventoryRoutes(database as never);
    const res = await routes.request("/missing");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Inventory stack not found" });
  });

  it("creates a new stack in an empty slot", async () => {
    const database = createMockDb();

    const duplicantWhere = mockSelectWhere(database, [{ id: "dup-1" }]);
    const itemWhere = mockSelectWhere(database, [
      { id: "item-1", name: "Copper", stackMax: 5 },
    ]);
    const slotWhere = mockSelectWhere(database, []);

    const created = {
      id: "stack-created",
      duplicantId: "dup-1",
      slot: 0,
      itemId: "item-1",
      qty: 1,
      durability: 80,
    };
    const returning = vi.fn().mockResolvedValue([created]);
    const values = vi.fn().mockReturnValue({ returning });
    database.insert.mockReturnValueOnce({ values });

    const routes = createInventoryRoutes(database as never);
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({
        duplicant: "dup-1",
        slot: 0,
        item: "item-1",
        durability: 80,
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(created);
    expect(duplicantWhere.where).toHaveBeenCalledTimes(1);
    expect(itemWhere.where).toHaveBeenCalledTimes(1);
    expect(slotWhere.where).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith({
      duplicantId: "dup-1",
      slot: 0,
      itemId: "item-1",
      qty: 1,
      durability: 80,
    });
  });

  it("rejects invalid inventory creation payloads", async () => {
    const database = createMockDb();
    const routes = createInventoryRoutes(database as never);

    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Invalid inventory payload" });
    expect(database.insert).not.toHaveBeenCalled();
  });

  it("rejects creating a stack when qty exceeds stackMax", async () => {
    const database = createMockDb();

    const duplicantWhere = mockSelectWhere(database, [{ id: "dup-1" }]);
    const itemWhere = mockSelectWhere(database, [
      { id: "item-1", name: "Copper", stackMax: 5 },
    ]);
    const slotWhere = mockSelectWhere(database, []);

    const routes = createInventoryRoutes(database as never);
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({
        duplicant: "dup-1",
        slot: 0,
        item: "item-1",
        qty: 10,
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("qty exceeds stackMax"),
    });
    expect(duplicantWhere.where).toHaveBeenCalledTimes(1);
    expect(itemWhere.where).toHaveBeenCalledTimes(1);
    expect(slotWhere.where).not.toHaveBeenCalled();
    expect(database.insert).not.toHaveBeenCalled();
  });

  it("rejects creating a stack when slot is occupied", async () => {
    const database = createMockDb();

    mockSelectWhere(database, [{ id: "dup-1" }]);
    mockSelectWhere(database, [
      { id: "item-1", name: "Copper", stackMax: 5 },
    ]);
    mockSelectWhere(database, [
      {
        id: "stack-existing",
        duplicantId: "dup-1",
        slot: 0,
        itemId: "item-1",
        qty: 3,
        durability: 100,
      },
    ]);

    const routes = createInventoryRoutes(database as never);
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({
        duplicant: "dup-1",
        slot: 0,
        item: "item-1",
        qty: 1,
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Slot occupied. Use merge=true or move endpoint.",
    });
  });

  it("rejects merging when items differ", async () => {
    const database = createMockDb();

    mockSelectWhere(database, [{ id: "dup-1" }]);
    mockSelectWhere(database, [
      { id: "item-1", name: "Copper", stackMax: 5 },
    ]);
    mockSelectWhere(database, [
      {
        id: "stack-existing",
        duplicantId: "dup-1",
        slot: 0,
        itemId: "item-2",
        qty: 1,
        durability: 90,
      },
    ]);

    const routes = createInventoryRoutes(database as never);
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({
        duplicant: "dup-1",
        slot: 0,
        item: "item-1",
        qty: 1,
        merge: true,
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Cannot merge different items in the same slot",
    });
  });

  it("rejects merging when quantities would exceed stackMax", async () => {
    const database = createMockDb();

    mockSelectWhere(database, [{ id: "dup-1" }]);
    mockSelectWhere(database, [
      { id: "item-1", name: "Copper", stackMax: 5 },
    ]);
    mockSelectWhere(database, [
      {
        id: "stack-existing",
        duplicantId: "dup-1",
        slot: 0,
        itemId: "item-1",
        qty: 4,
        durability: 90,
      },
    ]);

    const routes = createInventoryRoutes(database as never);
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({
        duplicant: "dup-1",
        slot: 0,
        item: "item-1",
        qty: 3,
        merge: true,
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Merge would exceed stackMax (5)",
    });
  });

  it("merges stacks and updates durability when provided", async () => {
    const database = createMockDb();

    mockSelectWhere(database, [{ id: "dup-1" }]);
    mockSelectWhere(database, [
      { id: "item-1", name: "Copper", stackMax: 5 },
    ]);
    mockSelectWhere(database, [
      {
        id: "stack-existing",
        duplicantId: "dup-1",
        slot: 0,
        itemId: "item-1",
        qty: 2,
        durability: 70,
      },
    ]);

    const returning = vi.fn().mockResolvedValue([
      {
        id: "stack-existing",
        duplicantId: "dup-1",
        slot: 0,
        itemId: "item-1",
        qty: 3,
        durability: 65,
      },
    ]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    database.update.mockReturnValueOnce({ set });

    const routes = createInventoryRoutes(database as never);
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({
        duplicant: "dup-1",
        slot: 0,
        item: "item-1",
        qty: 1,
        merge: true,
        durability: 65,
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ qty: 3, durability: 65 });
    expect(set).toHaveBeenCalledWith({ qty: 3, durability: 65 });
  });

  it("falls back to a default message when create fails without message", async () => {
    const database = createMockDb();
    const from = vi.fn(() => {
      throw {};
    });
    database.select.mockReturnValueOnce({ from });

    const routes = createInventoryRoutes(database as never);
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({
        duplicant: "dup-1",
        slot: 0,
        item: "item-1",
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Failed to create inventory" });
  });

  it("rejects creating a stack when duplicant is missing", async () => {
    const database = createMockDb();
    mockSelectWhere(database, []);

    const routes = createInventoryRoutes(database as never);
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({
        duplicant: "missing",
        slot: 0,
        item: "item-1",
        qty: 1,
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Duplicant not found" });
  });

  it("rejects creating a stack when item is missing", async () => {
    const database = createMockDb();

    mockSelectWhere(database, [{ id: "dup-1" }]);
    mockSelectWhere(database, []);

    const routes = createInventoryRoutes(database as never);
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({
        duplicant: "dup-1",
        slot: 0,
        item: "item-missing",
        qty: 1,
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Item definition not found" });
  });

  it("rejects invalid move payloads", async () => {
    const database = createMockDb();
    const routes = createInventoryRoutes(database as never);

    const res = await routes.request("/move", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Invalid move payload" });
  });

  it("reports move failures when the source slot is empty", async () => {
    const database = createMockDb();
    mockSelectWhere(database, [{ id: "dup-1" }]);
    mockSelectWhere(database, []);

    const routes = createInventoryRoutes(database as never);
    const res = await routes.request("/move", {
      method: "POST",
      body: JSON.stringify({
        duplicant: "dup-1",
        fromSlot: 0,
        toSlot: 1,
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "No stack in fromSlot" });
  });

  it("falls back to a default move error message when no message is provided", async () => {
    const database = createMockDb();
    const from = vi.fn(() => {
      throw {};
    });
    database.select.mockReturnValueOnce({ from });

    const routes = createInventoryRoutes(database as never);
    const res = await routes.request("/move", {
      method: "POST",
      body: JSON.stringify({
        duplicant: "dup-1",
        fromSlot: 0,
        toSlot: 1,
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Move failed" });
  });

  it("updates a stack payload", async () => {
    const database = createMockDb();
    const updated = {
      id: "stack-1",
      duplicantId: "dup-1",
      slot: 0,
      itemId: "item-1",
      qty: 2,
      durability: 75,
    };
    const returning = vi.fn().mockResolvedValue([updated]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    database.update.mockReturnValueOnce({ set });

    const itemDefinition = {
      id: "item-1",
      name: "Copper",
      stackMax: 5,
    };
    const existing = {
      id: "stack-1",
      duplicantId: "dup-1",
      slot: 0,
      itemId: "item-1",
      qty: 1,
      durability: 60,
    };
    mockSelectWhere(database, [existing]);
    mockSelectWhere(database, [itemDefinition]);

    const routes = createInventoryRoutes(database as never);
    const res = await routes.request(`/stack-1`, {
      method: "POST",
      body: JSON.stringify({ qty: 2, durability: 75 }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(updated);
    expect(set).toHaveBeenCalledWith({ qty: 2, durability: 75 });
  });

  it("rejects invalid stack updates", async () => {
    const database = createMockDb();
    mockSelectWhere(database, []);

    const routes = createInventoryRoutes(database as never);

    const res = await routes.request(`/stack-1`, {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Invalid inventory payload" });
    expect(database.update).not.toHaveBeenCalled();
  });

  it("returns 404 when updating a missing stack", async () => {
    const database = createMockDb();
    const returning = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    database.update.mockReturnValueOnce({ set });
    mockSelectWhere(database, []);

    const routes = createInventoryRoutes(database as never);
    const res = await routes.request(`/missing`, {
      method: "POST",
      body: JSON.stringify({ qty: 1 }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Inventory stack not found" });
  });

  it("updates a stack slot when the destination slot is free", async () => {
    const database = createMockDb();
    mockSelectWhere(database, [
      {
        id: "stack-slot",
        duplicantId: "dup-1",
        slot: 0,
        itemId: "item-1",
        qty: 1,
      },
    ]);
    mockSelectWhere(database, []);

    const returning = vi.fn().mockResolvedValue([
      {
        id: "stack-slot",
        duplicantId: "dup-1",
        slot: 2,
        itemId: "item-1",
        qty: 1,
      },
    ]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    database.update.mockReturnValueOnce({ set });

    const routes = createInventoryRoutes(database as never);
    const res = await routes.request(`/stack-slot`, {
      method: "POST",
      body: JSON.stringify({ slot: 2 }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ slot: 2 });
    expect(set).toHaveBeenCalledWith({ slot: 2 });
  });

  it("deletes a stack when qty is zero even if the driver returns no row", async () => {
    const database = createMockDb();
    mockSelectWhere(database, [
      {
        id: "stack-void",
        duplicantId: "dup-1",
        slot: 0,
        itemId: "item-1",
        qty: 2,
      },
    ]);
    const returning = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ returning });
    database.delete.mockReturnValueOnce({ where });

    const routes = createInventoryRoutes(database as never);
    const res = await routes.request(`/stack-void`, {
      method: "POST",
      body: JSON.stringify({ qty: 0 }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "stack-void", deleted: true });
  });

  it("deletes a stack", async () => {
    const database = createMockDb();
    const deleted = { id: "stack-1" };
    const returning = vi.fn().mockResolvedValue([deleted]);
    const where = vi.fn().mockReturnValue({ returning });
    database.delete.mockReturnValueOnce({ where });

    const routes = createInventoryRoutes(database as never);
    const res = await routes.request(`/stack-1`, { method: "DELETE" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(deleted);
  });

  it("returns 404 when deleting a missing stack", async () => {
    const database = createMockDb();
    const returning = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ returning });
    database.delete.mockReturnValueOnce({ where });

    const routes = createInventoryRoutes(database as never);
    const res = await routes.request(`/missing`, { method: "DELETE" });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Inventory stack not found" });
  });
});
