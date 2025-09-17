import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

import * as schema from "../db/schema.js";

let cachedMigrations: string[] | null = null;

async function loadMigrationStatements() {
  if (cachedMigrations) {
    return cachedMigrations;
  }

  const migrationsDir = path.resolve(process.cwd(), "drizzle");
  const files = (await readdir(migrationsDir)).filter((file) =>
    file.endsWith(".sql"),
  );

  files.sort();

  const statements: string[] = [];

  for (const file of files) {
    const fullPath = path.join(migrationsDir, file);
    const contents = await readFile(fullPath, "utf8");
    const parts = contents
      .split("--> statement-breakpoint")
      .map((chunk) => chunk.trim())
      .filter(Boolean);

    statements.push(...parts);
  }

  cachedMigrations = statements;
  return statements;
}

async function applyMigrations(client: PGlite) {
  const statements = await loadMigrationStatements();
  for (const sql of statements) {
    await client.exec(sql);
  }
}

export async function createTestDatabase() {
  const client = new PGlite(`memory://test-${randomUUID()}`);
  await client.waitReady;

  await applyMigrations(client);

  const db = drizzle({ client, schema });

  async function reset() {
    await client.exec("DROP SCHEMA public CASCADE;");
    await client.exec("CREATE SCHEMA public;");
    await applyMigrations(client);
  }

  async function close() {
    await client.close();
  }

  return {
    client,
    db,
    reset,
    close,
  };
}

export type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;
