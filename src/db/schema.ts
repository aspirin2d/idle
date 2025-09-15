import { pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { nanoid } from "nanoid";

export const scheduleActivityEnum = pgEnum("schedule_activity", [
  "work",
  "bedtime",
  "downtime",
  "bathtime",
]);

export const schedule = pgTable("schedule", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => nanoid()),
  activities: scheduleActivityEnum("activities").array(24).notNull(),
});

export const duplicant = pgTable("duplicant", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => nanoid()),
  name: text("name").notNull(),
  scheduleId: text("schedule_id").references(() => schedule.id),
  createdAt: timestamp("created_at", { withTimezone: false })
    .defaultNow()
    .notNull(),
});

export const scheduleRelations = relations(schedule, ({ many }) => ({
  duplicants: many(duplicant),
}));

export const duplicantRelations = relations(duplicant, ({ one }) => ({
  schedule: one(schedule, {
    fields: [duplicant.scheduleId],
    references: [schedule.id],
  }),
}));

export type Duplicant = typeof duplicant.$inferSelect;
export type NewDuplicant = typeof duplicant.$inferInsert;

export type Schedule = typeof schedule.$inferSelect;
export type NewSchedule = typeof schedule.$inferInsert;
export type ScheduleActivity = (typeof scheduleActivityEnum.enumValues)[number];
