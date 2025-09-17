import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createTaskRoutes } from "./task.js";
import { createTestDatabase, type TestDatabase } from "../test-utils/db.js";
import { task } from "../db/schema.js";

describe("task routes (integration)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  });

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(async () => {
    await testDb.reset();
  });

  it("lists all tasks", async () => {
    await testDb.db.insert(task).values({
      id: "task-1",
      description: "Mine",
      skillId: "dig",
      targetId: null,
    });

    const routes = createTaskRoutes(testDb.db);
    const res = await routes.request("/");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    const item = body[0];
    expect(item).toMatchObject({
      id: "task-1",
      description: "Mine",
      skillId: "dig",
      targetId: null,
    });
    expect(item.duplicants).toEqual([]);
    expect(typeof item.createdAt).toBe("string");
  });

  it("fetches a task by id", async () => {
    await testDb.db.insert(task).values({
      id: "task-42",
      description: "Cook",
      skillId: "cook",
      targetId: "kitchen",
    });

    const routes = createTaskRoutes(testDb.db);
    const res = await routes.request("/task-42");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      id: "task-42",
      description: "Cook",
      skillId: "cook",
      targetId: "kitchen",
    });
    expect(body.duplicants).toEqual([]);
    expect(typeof body.createdAt).toBe("string");
  });

  it("returns 404 for a missing task", async () => {
    const routes = createTaskRoutes(testDb.db);
    const res = await routes.request("/missing");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Task not found" });
  });

  it("creates a task from valid payload", async () => {
    const routes = createTaskRoutes(testDb.db);
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({
        description: "Research",
        skill: "science",
        target: null,
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({
      description: "Research",
      skillId: "science",
      targetId: null,
    });
    expect(typeof body.id).toBe("string");

    const rows = await testDb.db.query.task.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.description).toBe("Research");
  });

  it("rejects invalid task payloads", async () => {
    const routes = createTaskRoutes(testDb.db);
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({ description: "No skill" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: "Invalid task payload" });
  });

  it("updates an existing task", async () => {
    await testDb.db.insert(task).values({
      id: "task-2",
      description: "Sweep",
      skillId: "tidy",
      targetId: null,
    });

    const routes = createTaskRoutes(testDb.db);
    const res = await routes.request("/task-2", {
      method: "POST",
      body: JSON.stringify({ description: "Sweep floors", skill: "tidy" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.description).toBe("Sweep floors");

    const row = await testDb.db.query.task.findFirst({
      where: (tbl, { eq }) => eq(tbl.id, "task-2"),
    });
    expect(row?.description).toBe("Sweep floors");
  });

  it("returns 404 when updating a missing task", async () => {
    const routes = createTaskRoutes(testDb.db);
    const res = await routes.request("/missing", {
      method: "POST",
      body: JSON.stringify({ description: "Nope" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Task not found" });
  });

  it("rejects invalid task updates", async () => {
    await testDb.db.insert(task).values({
      id: "task-update",
      description: "Build",
      skillId: "build",
      targetId: null,
    });

    const routes = createTaskRoutes(testDb.db);
    const res = await routes.request("/task-update", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: "Invalid task payload" });
  });

  it("deletes a task", async () => {
    await testDb.db.insert(task).values({
      id: "task-del",
      description: "Dig",
      skillId: "dig",
      targetId: null,
    });

    const routes = createTaskRoutes(testDb.db);
    const res = await routes.request("/task-del", { method: "DELETE" });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("task-del");

    const rows = await testDb.db.query.task.findMany();
    expect(rows).toHaveLength(0);
  });

  it("returns 404 when deleting a missing task", async () => {
    const routes = createTaskRoutes(testDb.db);
    const res = await routes.request("/missing", { method: "DELETE" });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Task not found" });
  });
});

type MockDb = {
  query: {
    task: {
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
    };
  };
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

function createMockDb(): MockDb {
  return {
    query: {
      task: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
    },
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

describe("task routes (unit)", () => {
  it("lists all tasks", async () => {
    const database = createMockDb();
    const tasks = [
      {
        id: "task-1",
        description: "Mine",
        skillId: "dig",
        targetId: null,
        duplicants: [],
      },
    ];
    database.query.task.findMany.mockResolvedValueOnce(tasks);

    const routes = createTaskRoutes(database as never);
    const res = await routes.request("/");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(tasks);
    expect(database.query.task.findMany).toHaveBeenCalledWith({
      with: { duplicants: true },
    });
  });

  it("fetches a task by id", async () => {
    const database = createMockDb();
    const taskItem = {
      id: "task-42",
      description: "Cook",
      skillId: "cook",
      targetId: "kitchen",
      duplicants: [],
    };
    database.query.task.findFirst.mockResolvedValueOnce(taskItem);

    const routes = createTaskRoutes(database as never);
    const res = await routes.request(`/${taskItem.id}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(taskItem);
    expect(database.query.task.findFirst).toHaveBeenCalledTimes(1);
    const call = database.query.task.findFirst.mock.calls[0]?.[0];
    expect(call?.with).toEqual({ duplicants: true });
  });

  it("returns 404 for a missing task", async () => {
    const database = createMockDb();
    database.query.task.findFirst.mockResolvedValueOnce(undefined);

    const routes = createTaskRoutes(database as never);
    const res = await routes.request("/missing");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Task not found" });
  });

  it("creates a task from valid payload", async () => {
    const database = createMockDb();
    const created = {
      id: "task-new",
      description: "Research",
      skillId: "science",
      targetId: null,
    };
    const returning = vi.fn().mockResolvedValue([created]);
    const values = vi.fn().mockReturnValue({ returning });
    database.insert.mockReturnValueOnce({ values });

    const routes = createTaskRoutes(database as never);
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({ description: "Research", skill: "science" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(created);
    expect(values).toHaveBeenCalledWith({
      description: "Research",
      skillId: "science",
      targetId: null,
    });
  });

  it("allows explicitly setting a task id when creating", async () => {
    const database = createMockDb();
    const created = {
      id: "custom-id",
      description: "Inspect",
      skillId: "analysis",
      targetId: "lab",
    };
    const returning = vi.fn().mockResolvedValue([created]);
    const values = vi.fn().mockReturnValue({ returning });
    database.insert.mockReturnValueOnce({ values });

    const routes = createTaskRoutes(database as never);
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({
        id: "custom-id",
        description: "Inspect",
        skill: "analysis",
        target: "lab",
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(created);
    expect(values).toHaveBeenCalledWith({
      id: "custom-id",
      description: "Inspect",
      skillId: "analysis",
      targetId: "lab",
    });
  });

  it("rejects invalid task payloads", async () => {
    const database = createMockDb();
    const routes = createTaskRoutes(database as never);

    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "Invalid task payload",
    });
    expect(database.insert).not.toHaveBeenCalled();
  });

  it("validates skill alias mismatches", async () => {
    const database = createMockDb();
    const routes = createTaskRoutes(database as never);

    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({ description: "Build", skillId: "a", skill: "b" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Invalid task payload" });
  });

  it("updates a task", async () => {
    const database = createMockDb();
    const updated = {
      id: "task-1",
      description: "Sweep",
      skillId: "tidy",
      targetId: null,
    };
    const returning = vi.fn().mockResolvedValue([updated]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    database.update.mockReturnValueOnce({ set });

    const routes = createTaskRoutes(database as never);
    const res = await routes.request(`/task-1`, {
      method: "POST",
      body: JSON.stringify({ description: "Sweep" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(updated);
    expect(set).toHaveBeenCalledWith({ description: "Sweep" });
  });

  it("defaults target when updating with null alias", async () => {
    const database = createMockDb();
    const returning = vi.fn().mockResolvedValue([
      {
        id: "task-3",
        description: "Mine",
        skillId: "dig",
        targetId: null,
      },
    ]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    database.update.mockReturnValueOnce({ set });

    const routes = createTaskRoutes(database as never);
    const res = await routes.request(`/task-3`, {
      method: "POST",
      body: JSON.stringify({ target: null }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(set).toHaveBeenCalledWith({ targetId: null });
  });

  it("returns 404 when updating a missing task", async () => {
    const database = createMockDb();
    const returning = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    database.update.mockReturnValueOnce({ set });

    const routes = createTaskRoutes(database as never);
    const res = await routes.request(`/missing`, {
      method: "POST",
      body: JSON.stringify({ description: "Nope" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Task not found" });
  });

  it("rejects invalid task updates", async () => {
    const database = createMockDb();
    const routes = createTaskRoutes(database as never);

    const res = await routes.request(`/task-1`, {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "Invalid task payload",
    });
    expect(database.update).not.toHaveBeenCalled();
  });

  it("deletes a task", async () => {
    const database = createMockDb();
    const deleted = {
      id: "task-2",
      description: "Dig",
      skillId: "dig",
      targetId: null,
    };
    const returning = vi.fn().mockResolvedValue([deleted]);
    const where = vi.fn().mockReturnValue({ returning });
    database.delete.mockReturnValueOnce({ where });

    const routes = createTaskRoutes(database as never);
    const res = await routes.request(`/task-2`, { method: "DELETE" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(deleted);
  });

  it("returns 404 when deleting a missing task", async () => {
    const database = createMockDb();
    const returning = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ returning });
    database.delete.mockReturnValueOnce({ where });

    const routes = createTaskRoutes(database as never);
    const res = await routes.request(`/missing`, { method: "DELETE" });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Task not found" });
  });
});
