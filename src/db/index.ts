import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { schedule } from "./schema.js";
import type { ScheduleActivity } from "./schema.js";

export const DEFAULT_SCHEDULE_ID = "default";
export const DEFAULT_SCHEDULE_ACTIVITIES: ScheduleActivity[] = [
  // midnight–8AM bedtime
  ...Array(8).fill("bedtime"),
  // 8–9AM bathtime
  "bathtime",
  // 9AM–5PM work hours
  ...Array(8).fill("work"),
  // 5–midnight downtime
  ...Array(7).fill("downtime"),
];

const client = new PGlite(process.env.PG_DATA ?? "./pg_data");
const db = drizzle({ client });

export async function ensureDefaultSchedule() {
  const existing = await db
    .select({ id: schedule.id })
    .from(schedule)
    .where(eq(schedule.id, DEFAULT_SCHEDULE_ID));
  if (existing.length === 0) {
    await db.insert(schedule).values({
      id: DEFAULT_SCHEDULE_ID,
      activities: DEFAULT_SCHEDULE_ACTIVITIES,
    });
  }
}

export default db;
