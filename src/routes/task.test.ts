import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import { asc, desc } from "drizzle-orm";
import { task } from "../db/schema.js";

var selectMock: any;
var insertMock: any;
var updateMock: any;

vi.mock("../db/index.js", () => {
  selectMock = vi.fn();
  insertMock = vi.fn();
  updateMock = vi.fn();
  return {
    default: {
      select: (...args: any[]) => selectMock(...args),
      insert: (...args: any[]) => insertMock(...args),
      update: (...args: any[]) => updateMock(...args),
    },
  };
});

import taskRoute from "./task.js";

describe("taskRoute", () => {
  beforeEach(() => {
    selectMock.mockReset();
    insertMock.mockReset();
    updateMock.mockReset();
  });

  it("GET /duplicants/:id/tasks returns tasks", async () => {
    const tasks = [
      {
        id: "t1",
        duplicantId: "d1",
        description: "Dig",
        status: "pending",
        duration: 2,
        priority: 6,
        createdAt: "2024-01-01T00:00:00.000Z",
      },
    ];
    const orderByMock = vi.fn().mockResolvedValue(tasks);
    selectMock.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: orderByMock,
        }),
      }),
    });

    const app = new Hono();
    app.route("/", taskRoute);

    const res = await app.request("/duplicants/d1/tasks");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(tasks);
    expect(orderByMock).toHaveBeenCalledWith(
      desc(task.priority),
      asc(task.createdAt),
    );
  });

  it("POST /duplicants/:id/tasks creates a task", async () => {
    insertMock.mockReturnValue({
      values: (v: any) => ({
        returning: () => Promise.resolve([{ id: "t1", ...v }]),
      }),
    });

    const app = new Hono();
    app.route("/", taskRoute);

    const res = await app.request("/duplicants/d1/tasks", {
      method: "POST",
      body: JSON.stringify({
        description: "Build ladder",
        duration: 3,
        priority: 7,
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      id: "t1",
      duplicantId: "d1",
      description: "Build ladder",
      duration: 3,
      priority: 7,
      status: "pending",
    });
  });

  it("POST /duplicants/:id/tasks applies defaults when fields omitted", async () => {
    insertMock.mockReturnValue({
      values: (v: any) => ({
        returning: () => Promise.resolve([{ id: "t2", ...v }]),
      }),
    });

    const app = new Hono();
    app.route("/", taskRoute);

    const res = await app.request("/duplicants/d1/tasks", {
      method: "POST",
      body: JSON.stringify({ description: "Sweep", duration: 1 }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      id: "t2",
      duplicantId: "d1",
      description: "Sweep",
      duration: 1,
      priority: 5,
      status: "pending",
    });
  });

  it("PATCH /tasks/:taskId updates a task", async () => {
    const returningMock = vi.fn().mockResolvedValue([
      {
        id: "t1",
        duplicantId: "d1",
        description: "Build ladder",
        duration: 3,
        priority: 7,
        status: "complete",
      },
    ]);
    updateMock.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: returningMock,
        }),
      }),
    });

    const app = new Hono();
    app.route("/", taskRoute);

    const res = await app.request("/tasks/t1", {
      method: "PATCH",
      body: JSON.stringify({ status: "complete" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: "t1",
      duplicantId: "d1",
      description: "Build ladder",
      duration: 3,
      priority: 7,
      status: "complete",
    });
    expect(updateMock).toHaveBeenCalledWith(task);
  });

  it("PATCH /tasks/:taskId updates all provided fields", async () => {
    const returningMock = vi.fn().mockResolvedValue([
      {
        id: "t2",
        duplicantId: "d1",
        description: "Build ladder",
        duration: 4,
        priority: 8,
        status: "in-progress",
      },
    ]);
    updateMock.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: returningMock,
        }),
      }),
    });

    const app = new Hono();
    app.route("/", taskRoute);

    const res = await app.request("/tasks/t2", {
      method: "PATCH",
      body: JSON.stringify({
        description: "Build ladder",
        status: "in-progress",
        duration: 4,
        priority: 8,
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: "t2",
      duplicantId: "d1",
      description: "Build ladder",
      duration: 4,
      priority: 8,
      status: "in-progress",
    });
    expect(updateMock).toHaveBeenCalledWith(task);
  });
});
