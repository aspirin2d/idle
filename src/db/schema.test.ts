import { describe, expect, it } from "vitest";

import {
  TASK_STATUS,
  duplicant,
  inventory,
  duplicantInventoryRelations,
  duplicantRelations,
  itemCategoryEnum,
  itemDef,
  itemDefRelations,
  schedule,
  scheduleActivityEnum,
  scheduleRelations,
  skillDef,
  skillTargetDef,
  stats,
  task,
  taskRelation,
  taskStatusEnum,
} from "./schema.js";

describe("database schema", () => {
  it("defines expected enums", () => {
    expect(scheduleActivityEnum.enumValues).toEqual([
      "work",
      "bedtime",
      "downtime",
      "bathtime",
    ]);
    expect(taskStatusEnum.enumValues).toEqual([
      "pending",
      "in-progress",
      "complete",
    ]);
    expect(itemCategoryEnum.enumValues).toEqual([
      "material",
      "consumable",
      "tool",
      "equipment",
      "quest",
      "junk",
    ]);
    expect(TASK_STATUS).toMatchObject({
      PENDING: "pending",
      IN_PROGRESS: "in-progress",
      COMPLETE: "complete",
    });
  });

  it("exposes table metadata for core entities", () => {
    expect(itemDef).toHaveProperty("id");
    expect(skillDef).toHaveProperty("id");
    expect(skillTargetDef).toHaveProperty("id");
    expect(schedule).toHaveProperty("activities");
    expect(task).toHaveProperty("description");
    expect(stats).toHaveProperty("stamina");
    expect(duplicant).toHaveProperty("name");
    expect(inventory).toHaveProperty("slot");
  });

  it("creates relation descriptors for joined entities", () => {
    expect(itemDefRelations).toBeDefined();
    expect(duplicantInventoryRelations).toBeDefined();
    expect(scheduleRelations).toBeDefined();
    expect(taskRelation).toBeDefined();
    expect(duplicantRelations).toBeDefined();
  });
});
