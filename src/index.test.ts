import { describe, it, expect, vi, beforeEach } from "vitest";

const serveMock = vi.fn();
const ensureDefaultScheduleMock = vi.fn();

vi.mock("@hono/node-server", () => ({
  serve: serveMock,
}));

vi.mock("./db/index.js", () => ({
  ensureDefaultSchedule: ensureDefaultScheduleMock,
}));

describe("index", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    serveMock.mockReset();
    ensureDefaultScheduleMock.mockReset();
    delete process.env.PORT;
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("respects PORT environment variable", async () => {
    process.env.PORT = "4321";
    await import("./index.js");
    const [opts, cb] = serveMock.mock.calls[0];
    expect(opts.port).toBe(4321);
    cb({ port: opts.port });
    expect(console.log).toHaveBeenCalledWith(
      `Server is running on http://localhost:${opts.port}`,
    );
  });
});
