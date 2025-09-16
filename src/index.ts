import "dotenv/config";

import { serve } from "@hono/node-server";
import { Hono } from "hono";

import { ensureDefaultSchedule } from "./db/index.js";

const api = new Hono();
const app = new Hono();
app.get("/", (c) => {
  return c.text("Hello Hono!");
});

app.route("/api/v1", api);

const defaultPort = parseInt(process.env.PORT ?? "3000");

await ensureDefaultSchedule();

serve(
  {
    fetch: app.fetch,
    port: defaultPort,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);
