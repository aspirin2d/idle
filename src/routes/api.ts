import { Hono } from "hono";

import { duplicantRoutes } from "./duplicant.js";
import { scheduleRoutes } from "./schedule.js";
import { taskRoutes } from "./task.js";

const api = new Hono();

api.route("/schedule", scheduleRoutes);
api.route("/task", taskRoutes);
api.route("/duplicant", duplicantRoutes);

export { api };
