import { describe, it, expect, vi } from "vitest";

import { createTaskRoutes } from "./task.js";

type MockDb = {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

function createMockDb(): MockDb {
  return {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

describe("task routes", () => {
  it("lists all tasks", async () => {
    const database = createMockDb();
    const tasks = [
      { id: "task-1", description: "Mine", skillId: "dig", targetId: null },
    ];
    const from = vi.fn().mockResolvedValue(tasks);
    database.select.mockReturnValueOnce({ from });

    const routes = createTaskRoutes(database as never);
    const res = await routes.request("/");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(tasks);
    expect(database.select).toHaveBeenCalledTimes(1);
  });

  it("fetches a task by id", async () => {
    const database = createMockDb();
    const task = {
      id: "task-42",
      description: "Cook",
      skillId: "cook",
      targetId: "kitchen",
    };
    const where = vi.fn().mockResolvedValue([task]);
    const from = vi.fn().mockReturnValue({ where });
    database.select.mockReturnValueOnce({ from });

    const routes = createTaskRoutes(database as never);
    const res = await routes.request(`/${task.id}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(task);
    expect(where).toHaveBeenCalledTimes(1);
  });

  it("returns 404 for a missing task", async () => {
    const database = createMockDb();
    const where = vi.fn().mockResolvedValue([]);
    const from = vi.fn().mockReturnValue({ where });
    database.select.mockReturnValueOnce({ from });

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
