import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { eq } from "drizzle-orm";

import { createInventoryRoutes } from "./inventory.js";
import { createTestDatabase, type TestDatabase } from "../test-utils/db.js";
import {
  DEFAULT_IDLE_TASK_ID,
  DEFAULT_SCHEDULE_ACTIVITIES,
  DEFAULT_SCHEDULE_ID,
} from "../db/index.js";
import {
  duplicant,
  inventory,
  itemDef,
  schedule,
  stats,
  task,
} from "../db/schema.js";

describe("inventory routes", () => {
  let testDb: TestDatabase;
  let duplicantId: string;

  const DEFAULT_STATS = {
    stamina: 100,
    calories: 4000,
    bladder: 0,
  } as const;

  const buildRoutes = (
    overrides?: (base: TestDatabase["db"]) => Record<string, unknown>,
  ) => {
    if (!overrides) {
      return createInventoryRoutes(testDb.db);
    }
    const base = testDb.db;
    const proxy = Object.create(base);
    Object.assign(proxy, overrides(base));
    return createInventoryRoutes(proxy as never);
  };

  const seedStack = async (
    values: Partial<typeof inventory.$inferInsert> = {},
  ) => {
    const [row] = await testDb.db
      .insert(inventory)
      .values({
        duplicantId,
        slot: 0,
        itemId: "item-1",
        qty: 1,
        durability: 80,
        ...values,
      })
      .returning();
    return row!;
  };

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
      .values(DEFAULT_STATS)
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
      stackMax: 5,
      weight: 1,
      data: {},
      metadata: {},
    });
    await testDb.db.insert(itemDef).values({
      id: "item-2",
      name: "Iron",
      category: "material",
      stackMax: 10,
      weight: 1,
      data: {},
      metadata: {},
    });
  });

  it("requires the duplicant query parameter when listing", async () => {
    const routes = buildRoutes();
    const res = await routes.request("/");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Missing 'duplicant' query param",
    });
  });

  it("lists inventory stacks for a duplicant", async () => {
    await seedStack({ slot: 1, qty: 2 });
    await seedStack({ slot: 0, qty: 1 });

    const routes = buildRoutes();
    const res = await routes.request(`/?duplicant=${duplicantId}`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0]?.slot).toBe(0);
    expect(body[1]?.slot).toBe(1);
  });

  it("sorts results when the driver lacks orderBy", async () => {
    const routes = buildRoutes(() => ({
      select: () => ({
        from: () => ({
          where: async () => [
            { id: "b", slot: 2 },
            { id: "a", slot: 0 },
          ],
        }),
      }),
    }));

    const res = await routes.request(`/?duplicant=${duplicantId}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { id: "a", slot: 0 },
      { id: "b", slot: 2 },
    ]);
  });

  it("returns non-array results unchanged when the driver does not return rows", async () => {
    const routes = buildRoutes(() => ({
      select: () => ({
        from: () => ({
          where: async () => ({ data: "raw" }),
        }),
      }),
    }));

    const res = await routes.request(`/?duplicant=${duplicantId}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: "raw" });
  });

  it("sorts rows when slot values are missing", async () => {
    const routes = buildRoutes(() => ({
      select: () => ({
        from: () => ({
          where: async () => [
            { id: "b", slot: undefined },
            { id: "a", slot: 3 },
          ],
        }),
      }),
    }));

    const res = await routes.request(`/?duplicant=${duplicantId}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { id: "b", slot: undefined },
      { id: "a", slot: 3 },
    ]);
  });

  it("sorts rows when the driver returns undefined entries", async () => {
    const routes = buildRoutes(() => ({
      select: () => ({
        from: () => ({
          where: async () => [undefined, { id: "a", slot: 2 }],
        }),
      }),
    }));

    const res = await routes.request(`/?duplicant=${duplicantId}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "a", slot: 2 }, null]);
  });

  it("sorts rows when the comparator sees an undefined second value", async () => {
    const routes = buildRoutes(() => ({
      select: () => ({
        from: () => ({
          where: async () => [{ id: "a", slot: 2 }, undefined],
        }),
      }),
    }));

    const res = await routes.request(`/?duplicant=${duplicantId}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "a", slot: 2 }, null]);
  });

  it("fetches a stack by id", async () => {
    const stack = await seedStack({ slot: 2, qty: 3 });

    const routes = buildRoutes();
    const res = await routes.request(`/${stack.id}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: stack.id, slot: 2 });
  });

  it("returns 404 when fetching a missing stack", async () => {
    const routes = buildRoutes();
    const res = await routes.request("/missing");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Inventory stack not found" });
  });

  it("creates a new stack in an empty slot", async () => {
    const routes = buildRoutes();
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({
        duplicant: duplicantId,
        slot: 0,
        item: "item-1",
        qty: 2,
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ slot: 0, qty: 2 });

    const rows = await testDb.db.query.inventory.findMany();
    expect(rows).toHaveLength(1);
  });

  it("rejects invalid inventory creation payloads", async () => {
    const routes = buildRoutes();
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Invalid inventory payload" });
  });

  it("rejects creating a stack when qty exceeds stackMax", async () => {
    const routes = buildRoutes();
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({
        duplicant: duplicantId,
        slot: 0,
        item: "item-1",
        qty: 10,
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "qty exceeds stackMax (5)" });
  });

  it("rejects creating a stack when slot is occupied", async () => {
    await seedStack({ slot: 0 });

    const routes = buildRoutes();
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({
        duplicant: duplicantId,
        slot: 0,
        item: "item-1",
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Slot occupied. Use merge=true or move endpoint.",
    });
  });

  it("rejects creating a stack when duplicant is missing", async () => {
    const routes = buildRoutes();
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({
        duplicant: "missing",
        slot: 0,
        item: "item-1",
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Duplicant not found" });
  });

  it("rejects creating a stack when item is missing", async () => {
    const routes = buildRoutes();
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({
        duplicant: duplicantId,
        slot: 0,
        item: "item-missing",
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Item definition not found" });
  });

  it("rejects merging when items differ", async () => {
    await seedStack({ slot: 0, itemId: "item-1", qty: 1 });

    const routes = buildRoutes();
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({
        duplicant: duplicantId,
        slot: 0,
        item: "item-2",
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

  it("rejects merging when totals exceed stackMax", async () => {
    await seedStack({ slot: 0, qty: 4 });

    const routes = buildRoutes();
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({
        duplicant: duplicantId,
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
    await seedStack({ slot: 0, qty: 2, durability: 70 });

    const routes = buildRoutes();
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({
        duplicant: duplicantId,
        slot: 0,
        item: "item-1",
        qty: 1,
        merge: true,
        durability: 65,
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ qty: 3, durability: 65 });
  });

  it("merges stacks without altering durability when none provided", async () => {
    await seedStack({ slot: 0, qty: 2, durability: 70 });

    const routes = buildRoutes();
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({
        duplicant: duplicantId,
        slot: 0,
        item: "item-1",
        qty: 1,
        merge: true,
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ qty: 3, durability: 70 });
  });

  it("creates a stack when transactions are unavailable", async () => {
    const routes = buildRoutes(() => ({ transaction: undefined }));

    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({
        duplicant: duplicantId,
        slot: 0,
        item: "item-1",
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.slot).toBe(0);
  });

  it("falls back to a default message when create fails without message", async () => {
    const routes = buildRoutes((base) => ({
      transaction: async (fn: (tx: typeof base) => Promise<unknown>) => {
        await base.transaction(async (tx: typeof base) => {
          await fn(tx);
          throw {};
        });
      },
    }));

    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({
        duplicant: duplicantId,
        slot: 0,
        item: "item-1",
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Failed to create inventory" });
  });

  it("moves a stack to an empty slot", async () => {
    await seedStack({ slot: 0 });

    const routes = buildRoutes();
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
  });

  it("moves a stack when transactions are unavailable", async () => {
    await seedStack({ slot: 0 });

    const routes = buildRoutes(() => ({ transaction: undefined }));
    const res = await routes.request("/move", {
      method: "POST",
      body: JSON.stringify({
        duplicant: duplicantId,
        fromSlot: 0,
        toSlot: 1,
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.action).toBe("move");
    expect(body.moved.slot).toBe(1);
  });

  it("merges stacks during a move when possible", async () => {
    await seedStack({ slot: 0, qty: 4 });
    await seedStack({ slot: 1, qty: 1 });

    const routes = buildRoutes();
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
    expect(body.updated.qty).toBe(5);
  });

  it("partially merges stacks when totals exceed stackMax", async () => {
    await seedStack({ slot: 0, itemId: "item-1", qty: 4 });
    await seedStack({ slot: 1, itemId: "item-1", qty: 3 });

    const routes = buildRoutes();
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
    await seedStack({ slot: 0, itemId: "item-1", qty: 1 });
    await seedStack({ slot: 1, itemId: "item-2", qty: 2 });

    const routes = buildRoutes();
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
    const routes = buildRoutes();
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

  it("rejects invalid move payloads", async () => {
    const routes = buildRoutes();
    const res = await routes.request("/move", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Invalid move payload" });
  });

  it("rejects moves when the target slot is occupied without merge or swap", async () => {
    await seedStack({ slot: 0, qty: 1 });
    await seedStack({ slot: 1, qty: 2 });

    const routes = buildRoutes();
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

  it("falls back to a default move error message when no message is provided", async () => {
    await seedStack({ slot: 0, qty: 1 });

    const routes = buildRoutes((base) => ({
      transaction: async (fn: (tx: typeof base) => Promise<unknown>) => {
        await base.transaction(async (tx: typeof base) => {
          await fn(tx);
          throw {};
        });
      },
    }));

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
    expect(await res.json()).toEqual({ error: "Move failed" });
  });

  it("updates a stack and enforces stackMax", async () => {
    const stack = await seedStack({ slot: 0, itemId: "item-2", qty: 2 });

    const routes = buildRoutes();
    const res = await routes.request(`/${stack.id}`, {
      method: "POST",
      body: JSON.stringify({ qty: 4 }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect((await res.json()).qty).toBe(4);

    const invalidRes = await routes.request(`/${stack.id}`, {
      method: "POST",
      body: JSON.stringify({ qty: 12 }),
      headers: { "Content-Type": "application/json" },
    });

    expect(invalidRes.status).toBe(400);
    expect(await invalidRes.json()).toEqual({
      error: "qty exceeds stackMax (10)",
    });
  });

  it("updates only the durability of a stack", async () => {
    const stack = await seedStack({ slot: 0, durability: 50 });

    const routes = buildRoutes();
    const res = await routes.request(`/${stack.id}`, {
      method: "POST",
      body: JSON.stringify({ durability: 90 }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect((await res.json()).durability).toBe(90);
  });

  it("prevents slot updates when the destination is occupied", async () => {
    const stackA = await seedStack({ slot: 0, itemId: "item-1" });
    await seedStack({ slot: 1, itemId: "item-2" });

    const routes = buildRoutes();
    const res = await routes.request(`/${stackA.id}`, {
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
    const stack = await seedStack({ slot: 0 });

    const routes = buildRoutes();
    const res = await routes.request(`/${stack.id}`, {
      method: "POST",
      body: JSON.stringify({ slot: 2 }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slot).toBe(2);

    const row = await testDb.db.query.inventory.findFirst({
      where: (tbl, { eq }) => eq(tbl.id, stack.id),
    });
    expect(row?.slot).toBe(2);
  });

  it("rejects invalid stack updates", async () => {
    const stack = await seedStack();

    const routes = buildRoutes();
    const res = await routes.request(`/${stack.id}`, {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Invalid inventory payload" });
  });

  it("returns 404 when updating a missing stack", async () => {
    const routes = buildRoutes();
    const res = await routes.request("/missing", {
      method: "POST",
      body: JSON.stringify({ qty: 1 }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Inventory stack not found" });
  });

  it("deletes a stack when qty is set to 0", async () => {
    const stack = await seedStack({ slot: 0, qty: 2 });

    const routes = buildRoutes();
    const res = await routes.request(`/${stack.id}`, {
      method: "POST",
      body: JSON.stringify({ qty: 0 }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    const remaining = await testDb.db.query.inventory.findMany();
    expect(remaining).toHaveLength(0);
  });

  it("returns deletion metadata when the driver omits returning rows", async () => {
    const stack = await seedStack({ slot: 0, qty: 2 });

    const routes = buildRoutes((base) => ({
      delete: (...args: unknown[]) => {
        const builder = base.delete(...(args as Parameters<typeof base.delete>));
        const proxy = Object.create(builder);
        proxy.returning = async () => [];
        return proxy;
      },
    }));

    const res = await routes.request(`/${stack.id}`, {
      method: "POST",
      body: JSON.stringify({ qty: 0 }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: stack.id, deleted: true });
  });

  it("deletes a stack explicitly", async () => {
    const stack = await seedStack();

    const routes = buildRoutes();
    const res = await routes.request(`/${stack.id}`, { method: "DELETE" });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: stack.id });

    const remaining = await testDb.db.query.inventory.findMany();
    expect(remaining).toHaveLength(0);
  });

  it("returns 404 when deleting a missing stack", async () => {
    const routes = buildRoutes();
    const res = await routes.request("/missing", { method: "DELETE" });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Inventory stack not found" });
  });
});
