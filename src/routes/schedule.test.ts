import { describe, it, expect, vi } from "vitest";

import { createScheduleRoutes } from "./schedule.js";

type MockDb = {
  query: {
    schedule: {
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
      schedule: {
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

describe("schedule routes", () => {
  const activities = Array(24).fill("work");

  it("lists all schedules", async () => {
    const database = createMockDb();
    const schedules = [{ id: "sched-1", activities, duplicants: [] }];
    database.query.schedule.findMany.mockResolvedValueOnce(schedules);

    const routes = createScheduleRoutes(database as never);
    const res = await routes.request("/");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(schedules);
    expect(database.query.schedule.findMany).toHaveBeenCalledWith({
      with: { duplicants: true },
    });
  });

  it("fetches a schedule by id", async () => {
    const database = createMockDb();
    const scheduleItem = { id: "sched-42", activities, duplicants: [] };
    database.query.schedule.findFirst.mockResolvedValueOnce(scheduleItem);

    const routes = createScheduleRoutes(database as never);
    const res = await routes.request(`/${scheduleItem.id}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(scheduleItem);
    expect(database.query.schedule.findFirst).toHaveBeenCalledTimes(1);
    const call = database.query.schedule.findFirst.mock.calls[0]?.[0];
    expect(call?.with).toEqual({ duplicants: true });
  });

  it("returns 404 when a schedule is missing", async () => {
    const database = createMockDb();
    database.query.schedule.findFirst.mockResolvedValueOnce(undefined);

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

  it("allows explicitly setting an id when creating a schedule", async () => {
    const database = createMockDb();
    const created = { id: "custom-id", activities };
    const returning = vi.fn().mockResolvedValue([created]);
    const values = vi.fn().mockReturnValue({ returning });
    database.insert.mockReturnValueOnce({ values });

    const routes = createScheduleRoutes(database as never);
    const res = await routes.request("/", {
      method: "POST",
      body: JSON.stringify({ id: "custom-id", activities }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(created);
    expect(values).toHaveBeenCalledWith({ id: "custom-id", activities });
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

  it("rejects invalid schedule updates", async () => {
    const database = createMockDb();
    const routes = createScheduleRoutes(database as never);

    const res = await routes.request(`/sched-1`, {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "Invalid schedule payload",
    });
    expect(database.update).not.toHaveBeenCalled();
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
