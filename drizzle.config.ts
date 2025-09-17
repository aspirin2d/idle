/* istanbul ignore file */

import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql", // 'mysql' | 'sqlite' | 'turso'
  schema: "./src/db/schema.ts",
  driver: "pglite",
  dbCredentials: {
    url: process.env.PG_DATA ?? "./pg_data",
  },
});
