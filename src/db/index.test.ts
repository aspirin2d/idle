import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import db, {
  DEFAULT_IDLE_TASK_ID,
  DEFAULT_SCHEDULE_ACTIVITIES,
  DEFAULT_SCHEDULE_ID,
  ensureDefaultIdleTask,
  ensureDefaultSchedule,
  setDefaultDatabase,
} from "./index.js";
import { createTestDatabase, type TestDatabase } from "../test-utils/db.js";
import { schedule, task } from "./schema.js";

describe("database defaults", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    setDefaultDatabase(testDb.db as any);
  });

  afterAll(async () => {
    setDefaultDatabase(db as any);
    await testDb.close();
  });

  beforeEach(async () => {
    await testDb.reset();
  });

  it("inserts the default schedule when missing", async () => {
    await ensureDefaultSchedule(testDb.db as any);

    const rows = await testDb.db.query.schedule.findMany();
    expect(rows).toEqual([
      {
        id: DEFAULT_SCHEDULE_ID,
        activities: DEFAULT_SCHEDULE_ACTIVITIES,
      },
    ]);
  });

  it("does not insert the default schedule when it already exists", async () => {
    await testDb.db.insert(schedule).values({
      id: DEFAULT_SCHEDULE_ID,
      activities: DEFAULT_SCHEDULE_ACTIVITIES,
    });

    await ensureDefaultSchedule(testDb.db as any);

    const rows = await testDb.db.query.schedule.findMany();
    expect(rows).toHaveLength(1);
  });

  it("inserts the default idle task when missing", async () => {
    await ensureDefaultIdleTask(testDb.db as any);

    const rows = await testDb.db.query.task.findMany();
    expect(rows).toEqual([
      {
        id: DEFAULT_IDLE_TASK_ID,
        description: "Idle",
        skillId: "idle",
        targetId: null,
        duplicantId: null,
        createdAt: expect.any(Date),
      },
    ]);
  });

  it("does not insert the default idle task when present", async () => {
    await testDb.db.insert(task).values({
      id: DEFAULT_IDLE_TASK_ID,
      description: "Idle",
      skillId: "idle",
      targetId: null,
    });

    await ensureDefaultIdleTask(testDb.db as any);

    const rows = await testDb.db.query.task.findMany();
    expect(rows).toHaveLength(1);
  });

  it("falls back to the global database when omitted", async () => {
    await testDb.reset();

    await ensureDefaultSchedule();
    await ensureDefaultIdleTask();

    const schedules = await testDb.db.query.schedule.findMany();
    expect(schedules).toHaveLength(1);

    const tasks = await testDb.db.query.task.findMany();
    expect(tasks).toHaveLength(1);
  });
});
