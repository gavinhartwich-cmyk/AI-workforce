import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

/**
 * This repo's own database (agent_runs, agent_permissions, and later
 * sales_goals/manager_decisions/etc. — see schema.ts's header comment).
 * Separate from hartwich-os's database on purpose. Lazily constructed so
 * importing this module never fails just because AGENT_DATABASE_URL isn't
 * set yet (e.g. running unit tests, which use the in-memory audit sink
 * instead) — only actually connecting requires it.
 */
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (_db) return _db;
  const connectionString = process.env.AGENT_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "AGENT_DATABASE_URL is not set — required to use the Postgres-backed audit sink or policy store. See .env.example."
    );
  }
  const client = postgres(connectionString, { max: 5 });
  _db = drizzle(client, { schema });
  return _db;
}
