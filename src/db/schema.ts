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
 * Tables here correspond to spec §38/§48's `agent_*`/`sales_*`/`manager_*`
 * family. Phase 1 added `agent_runs` (the audit log) and
 * `agent_permissions` (policy rules). Phase 3 added the
 * Goal/KPI/Forecast/Manager-Decision tables. Phase 4 (SPEC.md §55) adds
 * `experiments`/`experiment_variants` below. Still not here: `agent_goals`,
 * `agent_tasks`, `agent_memory`, `agent_metrics`, `approval_requests` —
 * added in the phases that actually use them, not speculatively now.
 */

import { relations } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

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

// ---------------------------------------------------------------------------
// sales_goals — first-class goal objects (SPEC.md §8, §49)
// ---------------------------------------------------------------------------

export const goalPriorityEnum = pgEnum("goal_priority", ["low", "normal", "high", "critical"]);

export const goalStatusEnum = pgEnum("goal_status", [
  "NOT_STARTED",
  "ON_TRACK",
  "AT_RISK",
  "BEHIND",
  "CRITICAL",
  "ACHIEVED",
  "FAILED",
]);

// GoalMetric values live in src/goals/types.ts as a TS union, not a pg
// enum — new metrics (e.g. once Phase 4/5 add outreach data) shouldn't
// need a migration to become goal-able, just a KPI-engine case.
export const salesGoals = pgTable("sales_goals", {
  id: uuid("id").defaultRandom().primaryKey(),
  metric: text("metric").notNull(),
  target: numeric("target", { precision: 14, scale: 2 }).notNull(),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  priority: goalPriorityEnum("priority").notNull().default("normal"),
  constraints: jsonb("constraints").$type<{
    maxDailyOutreach?: number;
    maxBudget?: number;
    maxHumanHours?: number;
    allowedChannels?: string[];
  }>(),
  status: goalStatusEnum("status").notNull().default("NOT_STARTED"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// sales_kpi_snapshots — one row per KPI Engine computation (SPEC.md §10).
// A time series, not just a current value, so the Pace/Forecast engine has
// real velocity history to work from instead of only a straight-line
// average since the goal started.
// ---------------------------------------------------------------------------

export const salesKpiSnapshots = pgTable("sales_kpi_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  goalId: uuid("goal_id")
    .notNull()
    .references(() => salesGoals.id, { onDelete: "cascade" }),
  metric: text("metric").notNull(),
  value: numeric("value", { precision: 14, scale: 2 }),
  // 0-1 — how much this value should be trusted (SPEC.md §9's "mark
  // estimates as estimates"). Null `value` + confidence 0 means "no data
  // source wired up for this metric yet," not "the metric is zero."
  confidence: numeric("confidence", { precision: 3, scale: 2 }).notNull(),
  dataSource: text("data_source").notNull(),
  note: text("note"),
  asOf: timestamp("as_of", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// sales_forecasts — one row per Pace/Forecast Engine computation
// (SPEC.md §11-12).
// ---------------------------------------------------------------------------

export const salesForecasts = pgTable("sales_forecasts", {
  id: uuid("id").defaultRandom().primaryKey(),
  goalId: uuid("goal_id")
    .notNull()
    .references(() => salesGoals.id, { onDelete: "cascade" }),
  asOf: timestamp("as_of", { withTimezone: true }).notNull(),
  currentValue: numeric("current_value", { precision: 14, scale: 2 }).notNull(),
  expectedByNow: numeric("expected_by_now", { precision: 14, scale: 2 }).notNull(),
  currentPace: numeric("current_pace", { precision: 14, scale: 4 }).notNull(),
  requiredFuturePace: numeric("required_future_pace", { precision: 14, scale: 4 }).notNull(),
  projectedFinal: numeric("projected_final", { precision: 14, scale: 2 }).notNull(),
  // 0-100 — a documented heuristic (src/goals/pace-forecast.ts), not a
  // calibrated statistical model yet (SPEC.md §9: replace estimates with
  // real data as it accumulates).
  probability: integer("probability").notNull(),
  status: goalStatusEnum("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// manager_decisions — institutional memory (SPEC.md §36). Phase 3 writes a
// diagnosis-only record per goal-status computation (bottleneck found,
// selectedAction "none" — there's no autonomous decision-maker until
// Phase 9's Sales Manager exists to actually choose and act on an
// intervention). The shape is the full ManagerDecision interface from day
// one so Phase 9 extends this table's usage, not its structure.
// ---------------------------------------------------------------------------

export const managerDecisions = pgTable("manager_decisions", {
  id: uuid("id").defaultRandom().primaryKey(),
  goalId: uuid("goal_id")
    .notNull()
    .references(() => salesGoals.id, { onDelete: "cascade" }),
  observation: text("observation").notNull(),
  diagnosis: text("diagnosis").notNull(),
  options: jsonb("options")
    .$type<{ action: string; expectedImpact: number; confidence: number; risk: number }[]>()
    .notNull()
    .default([]),
  selectedAction: text("selected_action").notNull(),
  reason: text("reason").notNull(),
  expectedOutcome: text("expected_outcome").notNull(),
  actualOutcome: text("actual_outcome"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const salesGoalsRelations = relations(salesGoals, ({ many }) => ({
  kpiSnapshots: many(salesKpiSnapshots),
  forecasts: many(salesForecasts),
  decisions: many(managerDecisions),
}));

export const salesKpiSnapshotsRelations = relations(salesKpiSnapshots, ({ one }) => ({
  goal: one(salesGoals, { fields: [salesKpiSnapshots.goalId], references: [salesGoals.id] }),
}));

export const salesForecastsRelations = relations(salesForecasts, ({ one }) => ({
  goal: one(salesGoals, { fields: [salesForecasts.goalId], references: [salesGoals.id] }),
}));

export const managerDecisionsRelations = relations(managerDecisions, ({ one }) => ({
  goal: one(salesGoals, { fields: [managerDecisions.goalId], references: [salesGoals.id] }),
}));

// ---------------------------------------------------------------------------
// experiments / experiment_variants — controlled outreach tests
// (SPEC.md §34). Variant *assignment* is a pure deterministic hash function
// (src/experiments/assignment.ts) — no per-prospect assignment table to
// maintain, since the same (experimentId, prospectId) pair always resolves
// the same way.
// ---------------------------------------------------------------------------

export const experimentStatusEnum = pgEnum("experiment_status", ["running", "stopped", "concluded"]);

export const experiments = pgTable("experiments", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  minSampleSizePerVariant: integer("min_sample_size_per_variant").notNull(),
  status: experimentStatusEnum("status").notNull().default("running"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const experimentVariants = pgTable("experiment_variants", {
  id: uuid("id").defaultRandom().primaryKey(),
  experimentId: uuid("experiment_id")
    .notNull()
    .references(() => experiments.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  directive: text("directive").notNull(),
  weight: numeric("weight", { precision: 5, scale: 2 }).notNull().default("1"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const experimentsRelations = relations(experiments, ({ many }) => ({
  variants: many(experimentVariants),
}));

export const experimentVariantsRelations = relations(experimentVariants, ({ one }) => ({
  experiment: one(experiments, { fields: [experimentVariants.experimentId], references: [experiments.id] }),
}));

// ---------------------------------------------------------------------------
// suppressed_contacts — the opt-out list (SPEC.md §22, §32). Checked before
// every send, no exceptions. Phase 5 has no reply-classification agent yet
// (that's Phase 6's Conversation Intelligence) to detect "unsubscribe" in
// an inbound reply, so entries land here from a manual/scripted add for
// now — the enforcement is real even though the detection isn't automatic
// yet. This is this repo's own table (not hartwich-os's) because
// suppression must hold even if hartwich-os's own database is unreachable
// for a moment — a stricter fail-closed default than "assume it's fine."
// ---------------------------------------------------------------------------

export const suppressedContacts = pgTable("suppressed_contacts", {
  email: text("email").primaryKey(),
  reason: text("reason").notNull(),
  suppressedAt: timestamp("suppressed_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// outreach_control — a single-row kill switch (SPEC.md §57: "stop this
// campaign"). Checked before every autonomous send; Gavin flips it without
// touching a policy rule or redeploying anything.
// ---------------------------------------------------------------------------

export const outreachControl = pgTable("outreach_control", {
  id: text("id").primaryKey().default("default"),
  sendingPaused: boolean("sending_paused").notNull().default(false),
  pausedReason: text("paused_reason"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// groq_token_usage — how many Groq tokens the agents have spent today, so
// they can stop before eating the whole free-tier daily allowance.
//
// Groq's free tier caps tokens per day per *organization* (200k), and the
// Sales Manager chat in hartwich-os draws on that same pool. On 2026-09-10
// the agents used 198,528 of it by mid-afternoon and the chat — the one
// interactive, human-facing feature — couldn't answer a single message for
// the rest of the day. Batch work starving the interactive feature is the
// wrong tradeoff, so discovery now stops at its own budget (see
// src/runtime/token-budget.ts) and leaves the remainder for the chat.
//
// One row per UTC day. UTC because that's the window Groq's own cap tracks,
// which is what actually matters here — not Winnipeg's calendar day.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// manager_escalations — decisions the Sales Manager wants to make but isn't
// allowed to make alone (src/manager/authority-policy.ts), held until Gavin
// approves or rejects them on hartwich-os's /ai-workforce page.
//
// Before this existed, escalating only emailed Gavin and created a task —
// both of which are just *text describing* a recommendation, with nothing
// that could carry it out if he agreed. So the manager could never actually
// get a yes: every cycle it re-diagnosed the same bottleneck, re-escalated,
// and filed another duplicate task (7 identical ones on 2026-09-10 alone,
// one per 15-minute cycle). This table is what makes an approval mean
// something, and what lets a still-pending escalation suppress a duplicate.
//
// Owned here rather than in hartwich-os because the manager is what raises
// and executes these; hartwich-os only reads them and sets status (the same
// narrow-write exception it already uses for the outreach kill switch).
// ---------------------------------------------------------------------------

export const escalationStatusEnum = pgEnum("escalation_status", [
  "pending",
  "approved",
  "rejected",
  "executed",
  "failed",
]);

export const managerEscalations = pgTable("manager_escalations", {
  id: uuid("id").primaryKey().defaultRandom(),
  goalId: uuid("goal_id")
    .notNull()
    .references(() => salesGoals.id, { onDelete: "cascade" }),
  /** The capability the manager wants to exercise, e.g. "discover_prospects". */
  capability: text("capability").notNull(),
  /** How much it wants to change it by — the number that exceeded its authority. */
  proposedChangePercent: integer("proposed_change_percent"),
  action: text("action").notNull(),
  diagnosis: text("diagnosis").notNull(),
  whyApprovalRequired: text("why_approval_required").notNull(),
  /**
   * The goal's forecast status when this was raised. Kept so a settled
   * escalation's cooldown can be cut short if things have since got
   * materially worse — a rejection means "not under these conditions",
   * and a goal sliding from BEHIND to CRITICAL is different conditions.
   */
  forecastStatus: text("forecast_status"),
  expectedImpact: numeric("expected_impact"),
  risk: numeric("risk"),
  status: escalationStatusEnum("status").notNull().default("pending"),
  /** Set when execution is attempted after approval — why it failed, if it did. */
  executionNote: text("execution_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  executedAt: timestamp("executed_at", { withTimezone: true }),
});

export const managerEscalationsRelations = relations(managerEscalations, ({ one }) => ({
  goal: one(salesGoals, { fields: [managerEscalations.goalId], references: [salesGoals.id] }),
}));

export const groqTokenUsage = pgTable("groq_token_usage", {
  /** YYYY-MM-DD, UTC. */
  usageDate: text("usage_date").primaryKey(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
