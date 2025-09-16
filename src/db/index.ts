import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { schedule, task } from "./schema.js"; // <— add task
import type { ScheduleActivity } from "./schema.js";

export const DEFAULT_SCHEDULE_ID = "default";
export const DEFAULT_SCHEDULE_ACTIVITIES: ScheduleActivity[] = [
  ...Array(8).fill("bedtime"),
  "bathtime",
  ...Array(8).fill("work"),
  ...Array(7).fill("downtime"),
];

// NEW: default idle task id
export const DEFAULT_IDLE_TASK_ID = "idle";

const client = new PGlite(process.env.PG_DATA ?? "./pg_data");
const db = drizzle({ client });

type Database = typeof db;

export async function ensureDefaultSchedule(database: Database = db) {
  const existing = await database
    .select({ id: schedule.id })
    .from(schedule)
    .where(eq(schedule.id, DEFAULT_SCHEDULE_ID));
  if (existing.length === 0) {
    await database.insert(schedule).values({
      id: DEFAULT_SCHEDULE_ID,
      activities: DEFAULT_SCHEDULE_ACTIVITIES,
    });
  }
}

// NEW: ensure a global "idle" task exists
export async function ensureDefaultIdleTask(database: Database = db) {
  const existing = await database
    .select({ id: task.id })
    .from(task)
    .where(eq(task.id, DEFAULT_IDLE_TASK_ID));

  if (existing.length === 0) {
    await database.insert(task).values({
      id: DEFAULT_IDLE_TASK_ID,
      description: "Idle",
      skillId: "idle",
      targetId: null,
    });
  }
}

export default db;
