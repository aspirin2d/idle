import { Hono } from "hono";

import { duplicantRoutes } from "./duplicant.js";
import { duplicantTickRoutes } from "./duplicant-tick.js";
import { scheduleRoutes } from "./schedule.js";
import { inventoryRoutes } from "./inventory.js";
import { taskRoutes } from "./task.js";

const api = new Hono();

api.route("/schedule", scheduleRoutes);
api.route("/task", taskRoutes);
api.route("/inventory", inventoryRoutes);
api.route("/duplicant", duplicantRoutes);
api.route("/duplicant", duplicantTickRoutes);

export { api };
