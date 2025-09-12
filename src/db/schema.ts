import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";

export const cast = pgTable("cast", {
  id: text("id")
    .$defaultFn(() => nanoid())
    .primaryKey(),
  skill: text("skill_id").notNull(),
  target: text("target_id").notNull(),

  startedAt: timestamp("started_at", {
    mode: "string",
    withTimezone: true,
  }).notNull(),

  // how many times the cast is claimed so far
  claimed: integer("claimed").notNull().default(0),

  // maximum times this ticket can be claimed (NULL = unlimited)
  claimMax: integer("claim_max"),

  // duration per claim/tick in milliseconds
  claimInterval: integer("claim_interval").notNull(),
});
