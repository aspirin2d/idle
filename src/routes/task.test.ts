import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTaskRoutes } from "./task.js";

vi.mock("../db/index.js", () => ({
  __esModule: true,
  default: {},
}));

type Database = Parameters<typeof createTaskRoutes>[0];

type DbMock = {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

describe("task routes", () => {
  let dbMock: DbMock;

  beforeEach(() => {
    dbMock = {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
  });

  it("creates a new task with nullable target", async () => {
    const returning = vi
      .fn()
      .mockResolvedValue([
        { id: "1", description: "desc", skill: "skill", target: null },
      ]);
    const values = vi.fn().mockReturnValue({ returning });
    dbMock.insert.mockReturnValue({ values });

    const routes = createTaskRoutes(dbMock as unknown as Database);
    const response = await routes.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "desc", skill: "skill" }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      id: "1",
      description: "desc",
      skill: "skill",
      target: null,
    });
    expect(values).toHaveBeenCalledWith({
      description: "desc",
      skill: "skill",
      target: null,
    });
  });

  it("updates an existing task with provided fields", async () => {
    const returning = vi
      .fn()
      .mockResolvedValue([
        {
          id: "1",
          description: "updated",
          skill: "skill",
          target: "target",
        },
      ]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    dbMock.update.mockReturnValue({ set });

    const routes = createTaskRoutes(dbMock as unknown as Database);
    const response = await routes.request("/1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "updated" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "1",
      description: "updated",
      skill: "skill",
      target: "target",
    });
    expect(set).toHaveBeenCalledWith({ description: "updated" });
    expect(where).toHaveBeenCalledTimes(1);
  });
});
