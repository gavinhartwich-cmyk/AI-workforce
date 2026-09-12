import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

/**
 * Read (and, in later phases, narrowly-scoped write) access to hartwich-os's
 * own Postgres database — a different connection from this repo's own DB
 * (src/db/client.ts). Set HARTWICH_DATABASE_URL to hartwich-os's
 * DATABASE_URL (its Supabase transaction-pooler URI) to use real CRM tools
 * against production data; without it, tools that need this client fail
 * closed with a clear error rather than silently no-op-ing.
 */
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getHartwichOsDb() {
  if (_db) return _db;
  const connectionString = process.env.HARTWICH_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "HARTWICH_DATABASE_URL is not set — required for any tool that reads/writes hartwich-os's CRM data. See .env.example."
    );
  }
  const client = postgres(connectionString, { max: 5 });
  _db = drizzle(client, { schema });
  return _db;
}
