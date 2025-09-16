import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDuplicantRoutes } from "./duplicant.js";

vi.mock("../db/index.js", () => ({
  __esModule: true,
  default: {},
}));

type Database = Parameters<typeof createDuplicantRoutes>[0];

type DbMock = {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

describe("duplicant routes", () => {
  let dbMock: DbMock;

  beforeEach(() => {
    dbMock = {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
  });

  it("creates a duplicant with nullable relationships", async () => {
    const returning = vi
      .fn()
      .mockResolvedValue([
        { id: "1", name: "Ada", task: null, schedule: null },
      ]);
    const values = vi.fn().mockReturnValue({ returning });
    dbMock.insert.mockReturnValue({ values });

    const routes = createDuplicantRoutes(dbMock as unknown as Database);
    const response = await routes.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Ada" }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      id: "1",
      name: "Ada",
      task: null,
      schedule: null,
    });
    expect(values).toHaveBeenCalledWith({
      name: "Ada",
      task: null,
      schedule: null,
    });
  });

  it("returns 404 when deleting a missing duplicant", async () => {
    const returning = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ returning });
    dbMock.delete.mockReturnValue({ where });

    const routes = createDuplicantRoutes(dbMock as unknown as Database);
    const response = await routes.request("/missing", {
      method: "DELETE",
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Duplicant not found",
    });
    expect(where).toHaveBeenCalledTimes(1);
  });
});
