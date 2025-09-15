import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import { asc, desc } from "drizzle-orm";
import { task, TASK_STATUS } from "../db/schema.js";

var selectMock: any;
var insertMock: any;
var updateMock: any;
var deleteMock: any;

vi.mock("../db/index.js", () => {
  selectMock = vi.fn();
  insertMock = vi.fn();
  updateMock = vi.fn();
  deleteMock = vi.fn();
  return {
    default: {
      select: (...args: any[]) => selectMock(...args),
      insert: (...args: any[]) => insertMock(...args),
      update: (...args: any[]) => updateMock(...args),
      delete: (...args: any[]) => deleteMock(...args),
    },
  };
});

import taskRoute from "./task.js";
import { scheduleNextTask } from "./task.js";

describe("taskRoute", () => {
  beforeEach(() => {
    selectMock.mockReset();
    insertMock.mockReset();
    updateMock.mockReset();
    deleteMock.mockReset();

    // default mocks for scheduler internals
    selectMock.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
        }),
      }),
    });
    updateMock.mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue({}) }),
    });
    deleteMock.mockReturnValue({
      where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
    });
  });

  it("GET /duplicants/:id/tasks returns tasks", async () => {
    const tasks = [
      {
        id: "t1",
        duplicantId: "d1",
        description: "Dig",
        status: TASK_STATUS.PENDING,
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

  it("GET /duplicants/:id/tasks/current returns running task", async () => {
    const running = {
      id: "t1",
      duplicantId: "d1",
      description: "Dig",
      status: TASK_STATUS.IN_PROGRESS,
      duration: 2,
      priority: 6,
      createdAt: "2024-01-01T00:00:00.000Z",
    };
    const limitMock = vi.fn().mockResolvedValue([running]);
    selectMock.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: limitMock }),
      }),
    });

    const app = new Hono();
    app.route("/", taskRoute);

    const res = await app.request("/duplicants/d1/tasks/current");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(running);
    expect(limitMock).toHaveBeenCalledWith(1);
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
      status: TASK_STATUS.PENDING,
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
      status: TASK_STATUS.PENDING,
    });
  });


  it("DELETE /tasks/:taskId removes a task", async () => {
    const returningMock = vi.fn().mockResolvedValue([
      { id: "t1", duplicantId: "d1" },
    ]);
    deleteMock.mockReturnValueOnce({
      where: vi.fn().mockReturnValue({ returning: returningMock }),
    });

    const app = new Hono();
    app.route("/", taskRoute);

    const res = await app.request("/tasks/t1", { method: "DELETE" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "t1", duplicantId: "d1" });
    expect(deleteMock).toHaveBeenCalledWith(task);
  });

  it("POST /tasks/:taskId/claim marks task complete and schedules next", async () => {
    const returningMock = vi.fn().mockResolvedValue([
      {
        id: "t1",
        duplicantId: "d1",
        description: "Build ladder",
        duration: 3,
        priority: 7,
        status: TASK_STATUS.COMPLETE,
      },
    ]);
    updateMock.mockReturnValueOnce({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ returning: returningMock }),
      }),
    });

    const app = new Hono();
    app.route("/", taskRoute);

    const res = await app.request("/tasks/t1/claim", { method: "POST" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: "t1",
      duplicantId: "d1",
      description: "Build ladder",
      duration: 3,
      priority: 7,
      status: TASK_STATUS.COMPLETE,
    });
    expect(updateMock).toHaveBeenNthCalledWith(1, task);
  });
});

describe("scheduleNextTask", () => {
  it("starts highest priority pending task", async () => {
    const limitMock = vi
      .fn()
      .mockResolvedValue([
        {
          id: "t2",
          duplicantId: "d1",
        status: TASK_STATUS.PENDING,
          priority: 9,
          createdAt: new Date().toISOString(),
        },
      ]);
    selectMock.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({ limit: limitMock }),
        }),
      }),
    });

    const setCalls: any[] = [];
    updateMock.mockImplementation(() => ({
      set: (vals: any) => {
        setCalls.push(vals);
        return { where: vi.fn().mockResolvedValue({}) };
      },
    }));

    await scheduleNextTask("d1");

    expect(setCalls[0]).toEqual({ status: TASK_STATUS.PENDING });
    expect(setCalls[1]).toEqual({ status: TASK_STATUS.IN_PROGRESS });
    expect(limitMock).toHaveBeenCalledWith(1);
  });
});
