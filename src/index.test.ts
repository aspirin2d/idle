import { describe, it, expect, vi, beforeEach } from "vitest";

const serveMock = vi.fn();
const ensureDefaultScheduleMock = vi.fn();
const ensureDefaultIdleTaskMock = vi.fn(); // <—

const dbMock = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock("@hono/node-server", () => ({ serve: serveMock }));

vi.mock("./db/index.js", () => ({
  __esModule: true,
  ensureDefaultSchedule: ensureDefaultScheduleMock,
  ensureDefaultIdleTask: ensureDefaultIdleTaskMock, // <—
  default: dbMock,
}));

const ensureItemDefsSyncedOnStartMock = vi.fn();

vi.mock("./lib/items.js", () => ({
  __esModule: true,
  ensureItemDefsSyncedOnStart: ensureItemDefsSyncedOnStartMock,
}));

describe("index", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    serveMock.mockReset();
    ensureDefaultScheduleMock.mockReset();
    ensureDefaultIdleTaskMock.mockReset(); // <—
    Object.values(dbMock).forEach((fn) => fn.mockReset?.());
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
    // (Optional) sanity: defaults called
    expect(ensureDefaultScheduleMock).toHaveBeenCalled();
    expect(ensureDefaultIdleTaskMock).toHaveBeenCalled();
  });
});
