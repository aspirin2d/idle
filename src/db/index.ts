import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "./schema.js";
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
const db = drizzle({ client, schema });

type Database = typeof db;

export async function ensureDefaultSchedule(database: Database = db) {
  await database
    .insert(schedule)
    .values({
      id: DEFAULT_SCHEDULE_ID,
      activities: DEFAULT_SCHEDULE_ACTIVITIES,
    })
    .onConflictDoNothing({ target: schedule.id });
}

// NEW: ensure a global "idle" task exists
export async function ensureDefaultIdleTask(database: Database = db) {
  await database
    .insert(task)
    .values({
      id: DEFAULT_IDLE_TASK_ID,
      description: "Idle",
      skillId: "idle",
      targetId: null,
    })
    .onConflictDoNothing({ target: task.id });
}

export default db;
