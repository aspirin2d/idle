import { beforeEach, describe, expect, it, vi } from "vitest";

import { createScheduleRoutes } from "./schedule.js";

vi.mock("../db/index.js", () => ({
  __esModule: true,
  default: {},
}));

type Database = Parameters<typeof createScheduleRoutes>[0];

type DbMock = {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

const scheduleActivities = Array.from({ length: 24 }, () => "work");

describe("schedule routes", () => {
  let dbMock: DbMock;

  beforeEach(() => {
    dbMock = {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
  });

  it("lists schedules from the database", async () => {
    const schedules = [{ id: "1", activities: scheduleActivities }];
    const from = vi.fn().mockResolvedValue(schedules);
    dbMock.select.mockReturnValue({ from });

    const routes = createScheduleRoutes(dbMock as unknown as Database);
    const response = await routes.request("/", { method: "GET" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(schedules);
    expect(dbMock.select).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when updating a missing schedule", async () => {
    const returning = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    dbMock.update.mockReturnValue({ set });

    const routes = createScheduleRoutes(dbMock as unknown as Database);
    const response = await routes.request("/missing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activities: scheduleActivities }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Schedule not found",
    });
    expect(set).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledTimes(1);
  });
});
