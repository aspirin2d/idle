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

let defaultDatabase: Database = db;

export function setDefaultDatabase(database: Database) {
  defaultDatabase = database;
}

function getDatabase(database?: Database) {
  return (database ?? defaultDatabase) satisfies Database;
}

export async function ensureDefaultSchedule(database?: Database) {
  const dbInstance = getDatabase(database);

  const existing = await dbInstance
    .select({ id: schedule.id })
    .from(schedule)
    .where(eq(schedule.id, DEFAULT_SCHEDULE_ID));

  if (existing.length > 0) {
    return;
  }

  await dbInstance.insert(schedule).values({
    id: DEFAULT_SCHEDULE_ID,
    activities: DEFAULT_SCHEDULE_ACTIVITIES,
  });
}

// NEW: ensure a global "idle" task exists
export async function ensureDefaultIdleTask(database?: Database) {
  const dbInstance = getDatabase(database);

  const existing = await dbInstance
    .select({ id: task.id })
    .from(task)
    .where(eq(task.id, DEFAULT_IDLE_TASK_ID));

  if (existing.length > 0) {
    return;
  }

  await dbInstance.insert(task).values({
    id: DEFAULT_IDLE_TASK_ID,
    description: "Idle",
    skillId: "idle",
    targetId: null,
  });
}

export default db;
