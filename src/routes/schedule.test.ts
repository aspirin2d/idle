import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";

var selectMock: any;
var insertMock: any;

vi.mock("../db/index.js", () => {
  selectMock = vi.fn();
  insertMock = vi.fn();
  return {
    default: {
      select: (...args: any[]) => selectMock(...args),
      insert: (...args: any[]) => insertMock(...args),
    },
  };
});

import scheduleRoute from "./schedule.js";

describe("scheduleRoute", () => {
  beforeEach(() => {
    selectMock.mockReset();
    insertMock.mockReset();
  });

  it("GET / returns schedules", async () => {
    const schedules = [{ id: "s1", activities: Array(24).fill("work") }];
    selectMock.mockReturnValue({
      from: vi.fn().mockResolvedValue(schedules),
    });

    const app = new Hono();
    app.route("/", scheduleRoute);

    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(schedules);
  });

  it("POST / creates a schedule", async () => {
    const activities = Array(24).fill("work");
    insertMock.mockReturnValue({
      values: () => ({
        returning: () => Promise.resolve([{ id: "s1", activities }]),
      }),
    });

    const app = new Hono();
    app.route("/", scheduleRoute);

    const res = await app.request("/", {
      method: "POST",
      body: JSON.stringify({ activities }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "s1", activities });
  });

  it("POST / validates activities length", async () => {
    const app = new Hono();
    app.route("/", scheduleRoute);

    const res = await app.request("/", {
      method: "POST",
      body: JSON.stringify({ activities: ["work"] }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
  });

  it("POST / validates activities is an array", async () => {
    const app = new Hono();
    app.route("/", scheduleRoute);

    const res = await app.request("/", {
      method: "POST",
      body: JSON.stringify({ activities: "not-an-array" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
  });
});
