/**
 * Hartwich AI Workforce — this repo's OWN database schema.
 *
 * Deliberately separate from hartwich-os's schema (see README.md
 * "Architecture" and GAP_ANALYSIS.md §4/§10): this repo is a separate
 * service with its own database for agent-runtime state (runs, decisions,
 * goals, ...). It never defines companies/contacts/deals/etc. here — those
 * stay owned by hartwich-os. Where an agent needs CRM data, it reads/writes
 * hartwich-os's own database through the tool layer (src/tools/*), pointed
 * at hartwich-os's Postgres via HARTWICH_DATABASE_URL — see
 * src/db/hartwich-os/schema.ts for that narrow, explicitly-a-mirror subset.
 *
 * Tables here correspond to spec §38's `agents`/`agent_*` family. Phase 1
 * only needs `agent_runs` (the audit log — spec §26/§37) and
 * `agent_permissions` (policy rules — spec §32, loaded into
 * DefaultPolicyEngine at startup rather than hardcoded). The rest of §38's
 * list (agent_goals, agent_tasks, agent_memory, agent_metrics, sales_goals,
 * sales_kpis, ...) is added in the phases that actually use them (Phase 3+)
 * rather than speculatively now.
 */

import { relations } from "drizzle-orm";
import { boolean, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const agentRunStatusEnum = pgEnum("agent_run_status", ["succeeded", "failed", "denied"]);

// ---------------------------------------------------------------------------
// agent_runs — one row per AgentRuntime.run() call (spec §26, §37)
// ---------------------------------------------------------------------------

export const agentRuns = pgTable("agent_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  // Matches the runId the runtime generates in-process — kept as the
  // primary key (not a separate surrogate id) so log lines, tool-call
  // records, and this row all key off the same value.
  runId: uuid("run_id").notNull().unique(),
  agentId: text("agent_id").notNull(),
  agentVersion: text("agent_version").notNull(),
  model: text("model").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }).notNull(),
  input: jsonb("input").$type<unknown>(),
  output: jsonb("output").$type<unknown>(),
  toolCalls: jsonb("tool_calls").$type<{ tool: string; input: unknown; output: unknown }[]>().notNull().default([]),
  status: agentRunStatusEnum("status").notNull(),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// agent_permissions — policy rules loaded into the DefaultPolicyEngine
// (spec §32). Data, not code, so tightening/loosening what a mutating tool
// requires is a row change, not a deploy — same philosophy hartwich-os
// already applies to pipeline_stages/lead_sources_config.
// ---------------------------------------------------------------------------

export const agentPermissions = pgTable("agent_permissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  // "*" matches any tool — see DefaultPolicyEngine's rule lookup.
  tool: text("tool").notNull(),
  minAutonomyLevel: integer("min_autonomy_level").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const agentRunsRelations = relations(agentRuns, () => ({}));
