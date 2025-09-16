import {
  pgEnum,
  pgTable,
  text,
  timestamp,
  smallint,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
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

export const itemCategoryEnum = pgEnum("item_category", [
  "material",
  "consumable",
  "tool",
  "equipment",
  "quest",
  "junk",
]);

export const TASK_STATUS = {
  PENDING: "pending",
  IN_PROGRESS: "in-progress",
  COMPLETE: "complete",
} as const;

// item_def
export const itemDef = pgTable("item_def", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: itemCategoryEnum("category").notNull(),
  stackMax: smallint("stack_max").notNull().default(1),
  weight: smallint("weight").notNull().default(0),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  metadata: jsonb("metadata") // ← NEW
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  createdAt: timestamp("created_at", { withTimezone: false })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: false })
    .notNull()
    .defaultNow(),
});

// skill_def
export const skillDef = pgTable("skill_def", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  priority: smallint("priority").notNull().default(0),
  requirements: jsonb("requirements")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  metadata: jsonb("metadata") // ← NEW
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  createdAt: timestamp("created_at", { withTimezone: false })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: false })
    .notNull()
    .defaultNow(),
});

// skill_target_def
export const skillTargetDef = pgTable("skill_target_def", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  requirements: jsonb("requirements")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  metadata: jsonb("metadata") // ← NEW
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  createdAt: timestamp("created_at", { withTimezone: false })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: false })
    .notNull()
    .defaultNow(),
});

export const duplicantInventory = pgTable(
  "inventory",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    duplicantId: text("duplicant_id")
      .notNull()
      .references(() => duplicant.id, { onDelete: "cascade" }),
    slot: smallint("slot").notNull(), // 0-based slot index
    itemId: text("item_id")
      .notNull()
      .references(() => itemDef.id, { onDelete: "restrict" }),
    qty: smallint("qty").notNull().default(1), // 1..stackMax
    // optional for tools/equipment
    durability: smallint("durability"),
    createdAt: timestamp("created_at", { withTimezone: false })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // one stack per (duplicant, slot)
    /* c8 ignore start */
    uniqueIndex("uniq_dup_slot").on(t.duplicantId, t.slot),
    index("idx_dup_inv_dup").on(t.duplicantId),
    index("idx_dup_inv_item").on(t.itemId),
  ],
);

export const schedule = pgTable("schedule", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => nanoid()),
  activities: scheduleActivityEnum("activities").array(24).notNull(),
});

export const task = pgTable("task", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => nanoid()),
  description: text("description").notNull(),
  skillId: text("skill_id").notNull(), // skill reference
  targetId: text("target_id"), // skill target reference
  duplicantId: text("duplicant_id").references(() => duplicant.id),
  createdAt: timestamp("created_at", { withTimezone: false })
    .defaultNow()
    .notNull(),
});

export const stats = pgTable("stats", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => nanoid()),
  stamina: smallint("stamina").notNull(),
  calories: smallint("calories").notNull(),
  bladder: smallint("bladder").notNull(),
  duplicantId: text("duplicant_id").references(() => duplicant.id, {
    onDelete: "cascade",
  }),
});

export const duplicant = pgTable("duplicant", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => nanoid()),
  name: text("name").notNull(),
  taskId: text("task_id").notNull(), // assigned task
  scheduleId: text("schedule_id").notNull(),
  statsId: text("stats_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: false })
    .defaultNow()
    .notNull(),
});

export const itemDefRelations = relations(itemDef, ({ many }) => ({
  stacks: many(duplicantInventory),
}));

export const duplicantInventoryRelations = relations(
  duplicantInventory,
  ({ one }) => ({
    duplicant: one(duplicant, {
      fields: [duplicantInventory.duplicantId],
      references: [duplicant.id],
    }),
    item: one(itemDef, {
      fields: [duplicantInventory.itemId],
      references: [itemDef.id],
    }),
  }),
);

export const scheduleRelations = relations(schedule, ({ many }) => ({
  duplicants: many(duplicant),
}));

export const taskRelation = relations(task, ({ many }) => ({
  duplicants: many(duplicant),
}));

export const duplicantRelations = relations(duplicant, ({ one }) => ({
  schedule: one(schedule, {
    fields: [duplicant.scheduleId],
    references: [schedule.id],
  }),
  task: one(task, {
    fields: [duplicant.taskId],
    references: [task.id],
  }),
  stats: one(stats, {
    fields: [duplicant.statsId],
    references: [stats.id],
  }),
}));
/* c8 ignore end */

export type Duplicant = typeof duplicant.$inferSelect;
export type NewDuplicant = typeof duplicant.$inferInsert;

export type Task = typeof task.$inferSelect;
export type NewTask = typeof task.$inferInsert;

export type Schedule = typeof schedule.$inferSelect;
export type NewSchedule = typeof schedule.$inferInsert;
export type ScheduleActivity = (typeof scheduleActivityEnum.enumValues)[number];
export type TaskStatus = (typeof taskStatusEnum.enumValues)[number];

export type ItemCategory = (typeof itemCategoryEnum.enumValues)[number];
export type ItemDef = typeof itemDef.$inferSelect;
export type NewItemDef = typeof itemDef.$inferInsert;

export type DuplicantInventory = typeof duplicantInventory.$inferSelect;
export type NewDuplicantInventory = typeof duplicantInventory.$inferInsert;

export type SkillDef = typeof skillDef.$inferSelect;
export type NewSkillDef = typeof skillDef.$inferInsert;

export type SkillTargetDef = typeof skillTargetDef.$inferSelect;
export type NewSkillTargetDef = typeof skillTargetDef.$inferInsert;
