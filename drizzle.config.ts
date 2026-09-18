import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// Migrations for this repo's OWN database only (agent_runs,
// agent_permissions, ...). Never points at hartwich-os's database — that
// schema is owned and migrated by hartwich-os itself; this repo only reads/
// writes a narrow, explicitly-mirrored subset of it (src/db/hartwich-os/).
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.AGENT_DATABASE_URL ?? "",
  },
});
