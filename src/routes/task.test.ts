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

describe("task routes", () => {
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
    expect(body[0]).toMatchObject({ id: "task-1", description: "Mine" });
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
    expect(await res.json()).toMatchObject({
      id: "task-42",
      description: "Cook",
      skillId: "cook",
      targetId: "kitchen",
    });
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
      body: JSON.stringify({ description: "Research", skill: "science" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ description: "Research", skillId: "science" });

    const row = await testDb.db.query.task.findFirst({
      where: (tbl, { eq }) => eq(tbl.id, body.id),
    });
    expect(row).not.toBeNull();
  });

  it("creates a task using targetId when provided", async () => {
    const routes = createTaskRoutes(testDb.db);
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({
        description: "Inspect",
        skillId: "analysis",
        targetId: "building-7",
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ targetId: "building-7" });
  });

  it("allows explicitly setting a task id when creating", async () => {
    const routes = createTaskRoutes(testDb.db);
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
    const body = await res.json();
    expect(body.id).toBe("custom-id");
    expect(body.targetId).toBe("lab");
  });

  it("rejects invalid task payloads", async () => {
    const routes = createTaskRoutes(testDb.db);
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({ description: "No skill" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Invalid task payload" });
  });

  it("validates skill alias mismatches", async () => {
    const routes = createTaskRoutes(testDb.db);
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({
        description: "Build",
        skillId: "a",
        skill: "b",
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Invalid task payload" });
  });

  it("validates target alias mismatches", async () => {
    const routes = createTaskRoutes(testDb.db);
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({
        description: "Inspect",
        skillId: "analysis",
        targetId: "room-a",
        target: "room-b",
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Invalid task payload" });
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

  it("updates a task target when targetId is provided", async () => {
    await testDb.db.insert(task).values({
      id: "task-4",
      description: "Maintain",
      skillId: "maint",
      targetId: "machine-1",
    });

    const routes = createTaskRoutes(testDb.db);
    const res = await routes.request("/task-4", {
      method: "POST",
      body: JSON.stringify({ targetId: "machine-2" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.targetId).toBe("machine-2");
  });

  it("sets targetId to null when target alias is null", async () => {
    await testDb.db.insert(task).values({
      id: "task-5",
      description: "Inspect",
      skillId: "analysis",
      targetId: "room-a",
    });

    const routes = createTaskRoutes(testDb.db);
    const res = await routes.request("/task-5", {
      method: "POST",
      body: JSON.stringify({ target: null }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.targetId).toBeNull();
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
    expect(await res.json()).toMatchObject({ error: "Invalid task payload" });
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
    expect(await res.json()).toMatchObject({ id: "task-del" });

    const remaining = await testDb.db.query.task.findMany();
    expect(remaining).toHaveLength(0);
  });

  it("returns 404 when deleting a missing task", async () => {
    const routes = createTaskRoutes(testDb.db);
    const res = await routes.request("/missing", { method: "DELETE" });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Task not found" });
  });
});
