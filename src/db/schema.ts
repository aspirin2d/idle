import { pgEnum, pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { nanoid } from "nanoid";

export const scheduleActivityEnum = pgEnum("schedule_activity", [
  "work",
  "bedtime",
  "downtime",
  "bathtime",
]);

export const taskStatusEnum = pgEnum("task_status", [
  "pending",
  "in-progress",
  "complete",
]);

export const TASK_STATUS = {
  PENDING: "pending",
  IN_PROGRESS: "in-progress",
  COMPLETE: "complete",
} as const;

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

export const task = pgTable("task", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => nanoid()),
  duplicantId: text("duplicant_id")
    .notNull()
    .references(() => duplicant.id),
  description: text("description").notNull(),
  priority: integer("priority").notNull().default(5),
  duration: integer("duration").notNull(),
  status: taskStatusEnum("status").notNull().default(TASK_STATUS.PENDING),
  createdAt: timestamp("created_at", { withTimezone: false })
    .defaultNow()
    .notNull(),
});

export const scheduleRelations = relations(schedule, ({ many }) => ({
  duplicants: many(duplicant),
}));

export const duplicantRelations = relations(duplicant, ({ one, many }) => ({
  schedule: one(schedule, {
    fields: [duplicant.scheduleId],
    references: [schedule.id],
  }),
  tasks: many(task),
}));

export const taskRelations = relations(task, ({ one }) => ({
  duplicant: one(duplicant, {
    fields: [task.duplicantId],
    references: [duplicant.id],
  }),
}));

export type Duplicant = typeof duplicant.$inferSelect;
export type NewDuplicant = typeof duplicant.$inferInsert;

export type Task = typeof task.$inferSelect;
export type NewTask = typeof task.$inferInsert;

export type Schedule = typeof schedule.$inferSelect;
export type NewSchedule = typeof schedule.$inferInsert;
export type ScheduleActivity = (typeof scheduleActivityEnum.enumValues)[number];
export type TaskStatus = (typeof taskStatusEnum.enumValues)[number];
