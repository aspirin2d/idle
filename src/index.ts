import "dotenv/config";

import { serve } from "@hono/node-server";
import { Hono } from "hono";

import { ensureDefaultSchedule, ensureDefaultIdleTask } from "./db/index.js"; // <—
import { api } from "./routes/api.js";
import { ensureItemDefsSyncedOnStart } from "./lib/items.js";
import { ensureSkillTargetDefsSyncedOnStart } from "./lib/skill-targets.js";

const app = new Hono();

app.get("/", (c) => c.text("Hello Hono!"));
app.route("/api/v1", api);

export { app, api };

const defaultPort = parseInt(process.env.PORT ?? "3000");

// Ensure defaults before serving
await ensureDefaultSchedule();
await ensureDefaultIdleTask();
await ensureItemDefsSyncedOnStart();
await ensureSkillTargetDefsSyncedOnStart();

serve({ fetch: app.fetch, port: defaultPort }, (info) =>
  console.log(`Server is running on http://localhost:${info.port}`),
);
