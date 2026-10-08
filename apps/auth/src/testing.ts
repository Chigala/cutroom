/** A fresh account database (the real migrations, on node:sqlite) and a Worker env around it, for tests. */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Env } from "./auth.ts";

const MIGRATIONS = path.join(import.meta.dirname, "../migrations");

export function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync(MIGRATIONS).sort())
    if (file.endsWith(".sql")) db.exec(readFileSync(path.join(MIGRATIONS, file), "utf8"));
  return db;
}

export const testEnv = (db = freshDb(), more: Partial<Env> = {}): Env => ({
  DB: db,
  BETTER_AUTH_SECRET: "a-test-secret-that-is-long-enough-to-use",
  GOOGLE_CLIENT_ID: "google-client",
  GOOGLE_CLIENT_SECRET: "google-secret",
  ...more,
});
