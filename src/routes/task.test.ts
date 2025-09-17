import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
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
