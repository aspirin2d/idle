import { describe, it, expect, vi } from "vitest";

import { createInventoryRoutes } from "./inventory.js";

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

describe("inventory routes", () => {
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

  it("rejects creating a stack when qty exceeds stackMax", async () => {
    const database = createMockDb();

    mockSelectWhere(database, [{ id: "dup-1" }]);
    mockSelectWhere(database, [
      { id: "item-1", name: "Copper", stackMax: 2 },
    ]);
    mockSelectWhere(database, []);

    const routes = createInventoryRoutes(database as never);
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({
        duplicant: "dup-1",
        slot: 0,
        item: "item-1",
        qty: 3,
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "qty exceeds stackMax (2)",
    });
    expect(database.insert).not.toHaveBeenCalled();
  });

  it("creates a stack inside a transaction when supported", async () => {
    const inserted = {
      id: "stack-tx",
      duplicantId: "dup-1",
      slot: 0,
      itemId: "item-1",
      qty: 1,
      durability: 70,
    };

    const txSelectWhere = vi.fn().mockResolvedValue([]);
    const txSelectFrom = vi.fn().mockReturnValue({ where: txSelectWhere });
    const txSelect = vi.fn().mockReturnValue({ from: txSelectFrom });

    const txInsertReturning = vi.fn().mockResolvedValue([inserted]);
    const txInsertValues = vi.fn().mockReturnValue({ returning: txInsertReturning });
    const txInsert = vi.fn().mockReturnValue({ values: txInsertValues });

    const txUpdateWhere = vi.fn().mockResolvedValue(undefined);
    const txUpdateSet = vi.fn().mockReturnValue({ where: txUpdateWhere });
    const txUpdate = vi.fn().mockReturnValue({ set: txUpdateSet });

    const transaction = vi.fn(async (callback: (tx: any) => Promise<unknown>) =>
      callback({ select: txSelect, insert: txInsert, update: txUpdate, delete: vi.fn() }),
    );

    const database = createMockDb({ transaction });

    mockSelectWhere(database, [{ id: "dup-1" }]);
    mockSelectWhere(database, [
      { id: "item-1", name: "Copper", stackMax: 5 },
    ]);

    const routes = createInventoryRoutes(database as never);
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({
        duplicant: "dup-1",
        slot: 0,
        item: "item-1",
        durability: 70,
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(inserted);
    expect(transaction).toHaveBeenCalled();
    expect(txInsertValues).toHaveBeenCalledWith({
      duplicantId: "dup-1",
      slot: 0,
      itemId: "item-1",
      qty: 1,
      durability: 70,
    });
  });

  it("rejects creating a stack in an occupied slot when merge is disabled", async () => {
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
        qty: 3,
        durability: 50,
      },
    ]);

    const routes = createInventoryRoutes(database as never);
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({ duplicant: "dup-1", slot: 0, item: "item-1", qty: 1 }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Slot occupied. Use merge=true or move endpoint.",
    });
    expect(database.update).not.toHaveBeenCalled();
    expect(database.insert).not.toHaveBeenCalled();
  });

  it("rejects merging different items in the same slot", async () => {
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
        qty: 3,
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
    expect(database.update).not.toHaveBeenCalled();
  });

  it("rejects merges that would exceed the stack limit", async () => {
    const database = createMockDb();

    mockSelectWhere(database, [{ id: "dup-1" }]);
    mockSelectWhere(database, [
      { id: "item-1", name: "Copper", stackMax: 5 },
    ]);
    const existing = {
      id: "stack-existing",
      duplicantId: "dup-1",
      slot: 0,
      itemId: "item-1",
      qty: 4,
      durability: 60,
    };
    mockSelectWhere(database, [existing]);

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
    expect(database.update).not.toHaveBeenCalled();
  });

  it("merges into an existing stack when merge is enabled", async () => {
    const database = createMockDb();

    mockSelectWhere(database, [{ id: "dup-1" }]);
    mockSelectWhere(database, [
      { id: "item-1", name: "Copper", stackMax: 5 },
    ]);
    const existing = {
      id: "stack-existing",
      duplicantId: "dup-1",
      slot: 0,
      itemId: "item-1",
      qty: 2,
      durability: 60,
    };
    mockSelectWhere(database, [existing]);

    const updated = { ...existing, qty: 4, durability: 90 };
    const returning = vi.fn().mockResolvedValue([updated]);
    const set = vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({ returning }),
    });
    database.update.mockReturnValueOnce({ set });

    const routes = createInventoryRoutes(database as never);
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({
        duplicant: "dup-1",
        slot: 0,
        item: "item-1",
        qty: 2,
        merge: true,
        durability: 90,
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(updated);
    expect(set).toHaveBeenCalledWith({
      qty: 4,
      durability: 90,
    });
  });

  it("updates an inventory stack", async () => {
    const database = createMockDb();

    const current = {
      id: "stack-1",
      duplicantId: "dup-1",
      slot: 0,
      itemId: "item-1",
      qty: 2,
      durability: 40,
    };
    mockSelectWhere(database, [current]);
    mockSelectWhere(database, []);
    mockSelectWhere(database, [
      { id: "item-1", name: "Copper", stackMax: 5 },
    ]);

    const updated = { ...current, qty: 3, durability: 80, slot: 2 };
    const returning = vi.fn().mockResolvedValue([updated]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    database.update.mockReturnValueOnce({ set });

    const routes = createInventoryRoutes(database as never);
    const res = await routes.request(`/${current.id}`, {
      method: "POST",
      body: JSON.stringify({ qty: 3, durability: 80, slot: 2 }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(updated);
    expect(set).toHaveBeenCalledWith({ qty: 3, durability: 80, slot: 2 });
  });

  it("rejects invalid inventory updates", async () => {
    const database = createMockDb();
    const routes = createInventoryRoutes(database as never);

    const res = await routes.request(`/stack-1`, {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "Invalid inventory payload",
    });
    expect(database.update).not.toHaveBeenCalled();
  });

  it("rejects updating into an occupied slot", async () => {
    const database = createMockDb();

    const current = {
      id: "stack-1",
      duplicantId: "dup-1",
      slot: 0,
      itemId: "item-1",
      qty: 2,
      durability: 40,
    };
    mockSelectWhere(database, [current]);
    mockSelectWhere(database, [
      { id: "stack-other", duplicantId: "dup-1", slot: 2, itemId: "item-2", qty: 1 },
    ]);

    const routes = createInventoryRoutes(database as never);
    const res = await routes.request(`/${current.id}`, {
      method: "POST",
      body: JSON.stringify({ slot: 2 }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Target slot occupied. Use /inventory/move for swap/merge.",
    });
    expect(database.update).not.toHaveBeenCalled();
  });

  it("rejects inventory updates that exceed stack limits", async () => {
    const database = createMockDb();

    const current = {
      id: "stack-1",
      duplicantId: "dup-1",
      slot: 0,
      itemId: "item-1",
      qty: 2,
    };
    mockSelectWhere(database, [current]);
    mockSelectWhere(database, [
      { id: "item-1", name: "Copper", stackMax: 5 },
    ]);

    const routes = createInventoryRoutes(database as never);
    const res = await routes.request(`/${current.id}`, {
      method: "POST",
      body: JSON.stringify({ qty: 10 }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "qty exceeds stackMax (5)",
    });
    expect(database.update).not.toHaveBeenCalled();
  });

  it("deletes a stack when qty is set to 0", async () => {
    const database = createMockDb();

    const current = {
      id: "stack-1",
      duplicantId: "dup-1",
      slot: 0,
      itemId: "item-1",
      qty: 2,
    };
    mockSelectWhere(database, [current]);

    const deleted = { ...current, qty: 0 };
    const returning = vi.fn().mockResolvedValue([deleted]);
    const where = vi.fn().mockReturnValue({ returning });
    database.delete.mockReturnValueOnce({ where });

    const routes = createInventoryRoutes(database as never);
    const res = await routes.request(`/${current.id}`, {
      method: "POST",
      body: JSON.stringify({ qty: 0 }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(deleted);
    expect(returning).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when updating a missing stack", async () => {
    const database = createMockDb();
    mockSelectWhere(database, []);

    const routes = createInventoryRoutes(database as never);
    const res = await routes.request("/missing", {
      method: "POST",
      body: JSON.stringify({ qty: 1 }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Inventory stack not found" });
  });

  it("moves a stack to an empty slot", async () => {
    const database = createMockDb();

    mockSelectWhere(database, [{ id: "dup-1" }]);
    const fromStack = {
      id: "stack-from",
      duplicantId: "dup-1",
      slot: 0,
      itemId: "item-1",
      qty: 2,
    };
    mockSelectWhere(database, [fromStack]);
    mockSelectWhere(database, []);

    const moved = { ...fromStack, slot: 3 };
    const returning = vi.fn().mockResolvedValue([moved]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    database.update.mockReturnValueOnce({ set });

    const routes = createInventoryRoutes(database as never);
    const res = await routes.request("/move", {
      method: "POST",
      body: JSON.stringify({ duplicant: "dup-1", fromSlot: 0, toSlot: 3 }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ action: "move", moved });
    expect(set).toHaveBeenCalledWith({ slot: 3 });
  });

  it("performs moves inside a transaction when available", async () => {
    const fromStack = {
      id: "stack-from",
      duplicantId: "dup-1",
      slot: 0,
      itemId: "item-1",
      qty: 2,
    };
    const moved = { ...fromStack, slot: 3 };

    const txSelectWhere = vi
      .fn()
      .mockResolvedValueOnce([fromStack])
      .mockResolvedValueOnce([]);
    const txSelectFrom = vi.fn().mockReturnValue({ where: txSelectWhere });
    const txSelect = vi.fn().mockReturnValue({ from: txSelectFrom });

    const txUpdateReturning = vi.fn().mockResolvedValue([moved]);
    const txUpdateWhere = vi.fn().mockReturnValue({ returning: txUpdateReturning });
    const txUpdateSet = vi.fn().mockReturnValue({ where: txUpdateWhere });
    const txUpdate = vi.fn().mockReturnValue({ set: txUpdateSet });

    const transaction = vi.fn(async (callback: (tx: any) => Promise<unknown>) =>
      callback({ select: txSelect, update: txUpdate, insert: vi.fn(), delete: vi.fn() }),
    );

    const database = createMockDb({ transaction });
    mockSelectWhere(database, [{ id: "dup-1" }]);

    const routes = createInventoryRoutes(database as never);
    const res = await routes.request("/move", {
      method: "POST",
      body: JSON.stringify({ duplicant: "dup-1", fromSlot: 0, toSlot: 3 }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ action: "move", moved });
    expect(transaction).toHaveBeenCalled();
    expect(txUpdateSet).toHaveBeenCalledWith({ slot: 3 });
  });

  it("merges stacks during a move when possible", async () => {
    const database = createMockDb();

    mockSelectWhere(database, [{ id: "dup-1" }]);
    const fromStack = {
      id: "stack-from",
      duplicantId: "dup-1",
      slot: 0,
      itemId: "item-1",
      qty: 1,
    };
    const toStack = {
      id: "stack-to",
      duplicantId: "dup-1",
      slot: 2,
      itemId: "item-1",
      qty: 2,
    };
    mockSelectWhere(database, [fromStack]);
    mockSelectWhere(database, [toStack]);
    mockSelectWhere(database, [
      { id: "item-1", name: "Copper", stackMax: 5 },
    ]);

    const updatedTo = { ...toStack, qty: 3 };
    const updateReturning = vi.fn().mockResolvedValue([updatedTo]);
    const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    database.update.mockReturnValueOnce({ set: updateSet });

    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    database.delete.mockReturnValueOnce({ where: deleteWhere });

    const routes = createInventoryRoutes(database as never);
    const res = await routes.request("/move", {
      method: "POST",
      body: JSON.stringify({
        duplicant: "dup-1",
        fromSlot: 0,
        toSlot: 2,
        merge: true,
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      action: "merge_all_into_to",
      updated: updatedTo,
    });
    expect(database.update).toHaveBeenCalledTimes(1);
    expect(database.delete).toHaveBeenCalledTimes(1);
  });

  it("splits stacks across slots when only a partial merge fits", async () => {
    const database = createMockDb();

    mockSelectWhere(database, [{ id: "dup-1" }]);
    const fromStack = {
      id: "stack-from",
      duplicantId: "dup-1",
      slot: 0,
      itemId: "item-1",
      qty: 5,
    };
    const toStack = {
      id: "stack-to",
      duplicantId: "dup-1",
      slot: 2,
      itemId: "item-1",
      qty: 4,
    };
    mockSelectWhere(database, [fromStack]);
    mockSelectWhere(database, [toStack]);
    mockSelectWhere(database, [
      { id: "item-1", name: "Copper", stackMax: 6 },
    ]);

    const updatedTo = { ...toStack, qty: 6 };
    const updateToReturning = vi.fn().mockResolvedValue([updatedTo]);
    const updateToWhere = vi.fn().mockReturnValue({ returning: updateToReturning });
    const updateToSet = vi.fn().mockReturnValue({ where: updateToWhere });

    const updatedFrom = { ...fromStack, qty: 3 };
    const updateFromReturning = vi.fn().mockResolvedValue([updatedFrom]);
    const updateFromWhere = vi.fn().mockReturnValue({ returning: updateFromReturning });
    const updateFromSet = vi.fn().mockReturnValue({ where: updateFromWhere });

    database.update
      .mockReturnValueOnce({ set: updateToSet })
      .mockReturnValueOnce({ set: updateFromSet });

    const routes = createInventoryRoutes(database as never);
    const res = await routes.request("/move", {
      method: "POST",
      body: JSON.stringify({
        duplicant: "dup-1",
        fromSlot: 0,
        toSlot: 2,
        merge: true,
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      action: "merge_partial",
      to: updatedTo,
      from: updatedFrom,
    });
    expect(database.update).toHaveBeenCalledTimes(2);
    expect(database.delete).not.toHaveBeenCalled();
  });

  it("swaps stacks when merge is not possible but swapping is allowed", async () => {
    const database = createMockDb();

    mockSelectWhere(database, [{ id: "dup-1" }]);
    const fromStack = {
      id: "stack-from",
      duplicantId: "dup-1",
      slot: 0,
      itemId: "item-1",
      qty: 1,
    };
    const toStack = {
      id: "stack-to",
      duplicantId: "dup-1",
      slot: 2,
      itemId: "item-2",
      qty: 2,
    };
    mockSelectWhere(database, [fromStack]);
    mockSelectWhere(database, [toStack]);

    const movedFrom = { ...fromStack, slot: 2 };
    const movedTo = { ...toStack, slot: 0 };

    const fromReturning = vi.fn().mockResolvedValue([movedFrom]);
    const fromWhere = vi.fn().mockReturnValue({ returning: fromReturning });
    const fromSet = vi.fn().mockReturnValue({ where: fromWhere });

    const toReturning = vi.fn().mockResolvedValue([movedTo]);
    const toWhere = vi.fn().mockReturnValue({ returning: toReturning });
    const toSet = vi.fn().mockReturnValue({ where: toWhere });

    database.update
      .mockReturnValueOnce({ set: fromSet })
      .mockReturnValueOnce({ set: toSet });

    const routes = createInventoryRoutes(database as never);
    const res = await routes.request("/move", {
      method: "POST",
      body: JSON.stringify({
        duplicant: "dup-1",
        fromSlot: 0,
        toSlot: 2,
        merge: false,
        allowSwap: true,
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ action: "swap", a: movedFrom, b: movedTo });
    expect(database.update).toHaveBeenCalledTimes(2);
  });

  it("errors when merge and swap are both disallowed", async () => {
    const database = createMockDb();

    mockSelectWhere(database, [{ id: "dup-1" }]);
    const fromStack = {
      id: "stack-from",
      duplicantId: "dup-1",
      slot: 0,
      itemId: "item-1",
      qty: 1,
    };
    const toStack = {
      id: "stack-to",
      duplicantId: "dup-1",
      slot: 2,
      itemId: "item-2",
      qty: 2,
    };
    mockSelectWhere(database, [fromStack]);
    mockSelectWhere(database, [toStack]);

    const routes = createInventoryRoutes(database as never);
    const res = await routes.request("/move", {
      method: "POST",
      body: JSON.stringify({
        duplicant: "dup-1",
        fromSlot: 0,
        toSlot: 2,
        merge: false,
        allowSwap: false,
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Target slot occupied and merge/swap not permitted",
    });
    expect(database.update).not.toHaveBeenCalled();
  });

  it("returns an error when moving from an empty slot", async () => {
    const database = createMockDb();

    mockSelectWhere(database, [{ id: "dup-1" }]);
    mockSelectWhere(database, []);

    const routes = createInventoryRoutes(database as never);
    const res = await routes.request("/move", {
      method: "POST",
      body: JSON.stringify({ duplicant: "dup-1", fromSlot: 0, toSlot: 1 }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "No stack in fromSlot" });
  });

  it("deletes an inventory stack", async () => {
    const database = createMockDb();

    const deleted = {
      id: "stack-1",
      duplicantId: "dup-1",
      slot: 0,
      itemId: "item-1",
      qty: 0,
    };
    const returning = vi.fn().mockResolvedValue([deleted]);
    const where = vi.fn().mockReturnValue({ returning });
    database.delete.mockReturnValueOnce({ where });

    const routes = createInventoryRoutes(database as never);
    const res = await routes.request("/stack-1", { method: "DELETE" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(deleted);
    expect(returning).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when deleting a missing stack", async () => {
    const database = createMockDb();
    const returning = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ returning });
    database.delete.mockReturnValueOnce({ where });

    const routes = createInventoryRoutes(database as never);
    const res = await routes.request("/missing", { method: "DELETE" });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Inventory stack not found" });
  });
});
