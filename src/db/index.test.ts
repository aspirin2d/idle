import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_IDLE_TASK_ID,
  DEFAULT_SCHEDULE_ACTIVITIES,
  DEFAULT_SCHEDULE_ID,
  ensureDefaultIdleTask,
  ensureDefaultSchedule,
} from "./index.js";

type MockDb = {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
};

function createDbMock(existing: Array<{ id: string }> = []): MockDb & {
  selectFrom: ReturnType<typeof vi.fn>;
  selectWhere: ReturnType<typeof vi.fn>;
  values: ReturnType<typeof vi.fn>;
} {
  const selectWhere = vi.fn().mockResolvedValue(existing);
  const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
  const select = vi.fn().mockReturnValue({ from: selectFrom });

  const values = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn().mockReturnValue({ values });

  return { select, insert, selectFrom, selectWhere, values };
}

describe("database defaults", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("inserts the default schedule when missing", async () => {
    const mock = createDbMock([]);

    await ensureDefaultSchedule(mock as unknown as never);

    expect(mock.selectWhere).toHaveBeenCalledTimes(1);
    expect(mock.values).toHaveBeenCalledWith({
      id: DEFAULT_SCHEDULE_ID,
      activities: DEFAULT_SCHEDULE_ACTIVITIES,
    });
  });

  it("does not insert the default schedule when it already exists", async () => {
    const mock = createDbMock([{ id: DEFAULT_SCHEDULE_ID }]);

    await ensureDefaultSchedule(mock as unknown as never);

    expect(mock.values).not.toHaveBeenCalled();
  });

  it("inserts the default idle task when missing", async () => {
    const mock = createDbMock([]);

    await ensureDefaultIdleTask(mock as unknown as never);

    expect(mock.values).toHaveBeenCalledWith({
      id: DEFAULT_IDLE_TASK_ID,
      description: "Idle",
      skillId: "idle",
      targetId: null,
    });
  });

  it("does not insert the default idle task when present", async () => {
    const mock = createDbMock([{ id: DEFAULT_IDLE_TASK_ID }]);

    await ensureDefaultIdleTask(mock as unknown as never);

    expect(mock.values).not.toHaveBeenCalled();
  });
});
