import { describe, it, expect, vi } from "vitest";

import { createScheduleRoutes } from "./schedule.js";

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

describe("schedule routes", () => {
  const activities = Array(24).fill("work");

  it("lists all schedules", async () => {
    const database = createMockDb();
    const schedules = [{ id: "sched-1", activities }];
    const from = vi.fn().mockResolvedValue(schedules);
    database.select.mockReturnValueOnce({ from });

    const routes = createScheduleRoutes(database as never);
    const res = await routes.request("/");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(schedules);
    expect(database.select).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("fetches a schedule by id", async () => {
    const database = createMockDb();
    const scheduleItem = { id: "sched-42", activities };
    const where = vi.fn().mockResolvedValue([scheduleItem]);
    const from = vi.fn().mockReturnValue({ where });
    database.select.mockReturnValueOnce({ from });

    const routes = createScheduleRoutes(database as never);
    const res = await routes.request(`/${scheduleItem.id}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(scheduleItem);
    expect(where).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when a schedule is missing", async () => {
    const database = createMockDb();
    const where = vi.fn().mockResolvedValue([]);
    const from = vi.fn().mockReturnValue({ where });
    database.select.mockReturnValueOnce({ from });

    const routes = createScheduleRoutes(database as never);
    const res = await routes.request("/missing");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Schedule not found" });
  });

  it("creates a schedule from valid payload", async () => {
    const database = createMockDb();
    const created = { id: "sched-created", activities };
    const returning = vi.fn().mockResolvedValue([created]);
    const values = vi.fn().mockReturnValue({ returning });
    database.insert.mockReturnValueOnce({ values });

    const routes = createScheduleRoutes(database as never);
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({ activities }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(created);
    expect(values).toHaveBeenCalledWith({ activities });
  });

  it("rejects invalid schedule payloads", async () => {
    const database = createMockDb();
    const routes = createScheduleRoutes(database as never);

    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({ activities: ["work"] }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "Invalid schedule payload",
    });
    expect(database.insert).not.toHaveBeenCalled();
  });

  it("updates a schedule", async () => {
    const database = createMockDb();
    const updated = { id: "sched-2", activities };
    const returning = vi.fn().mockResolvedValue([updated]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    database.update.mockReturnValueOnce({ set });

    const routes = createScheduleRoutes(database as never);
    const res = await routes.request(`/sched-2`, {
      method: "POST",
      body: JSON.stringify({ activities }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(updated);
    expect(set).toHaveBeenCalledWith({ activities });
  });

  it("returns 404 when updating a missing schedule", async () => {
    const database = createMockDb();
    const returning = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    database.update.mockReturnValueOnce({ set });

    const routes = createScheduleRoutes(database as never);
    const res = await routes.request(`/missing`, {
      method: "POST",
      body: JSON.stringify({ activities }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Schedule not found" });
  });

  it("deletes a schedule", async () => {
    const database = createMockDb();
    const deleted = { id: "sched-2", activities };
    const returning = vi.fn().mockResolvedValue([deleted]);
    const where = vi.fn().mockReturnValue({ returning });
    database.delete.mockReturnValueOnce({ where });

    const routes = createScheduleRoutes(database as never);
    const res = await routes.request(`/sched-2`, { method: "DELETE" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(deleted);
  });

  it("returns 404 when deleting a missing schedule", async () => {
    const database = createMockDb();
    const returning = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ returning });
    database.delete.mockReturnValueOnce({ where });

    const routes = createScheduleRoutes(database as never);
    const res = await routes.request(`/missing`, { method: "DELETE" });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Schedule not found" });
  });
});
