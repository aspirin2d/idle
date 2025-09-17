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
