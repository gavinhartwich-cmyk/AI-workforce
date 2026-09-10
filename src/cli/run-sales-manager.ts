/**
 * The Sales Manager's own decision loop, on its own schedule — separate
 * from run-cycle.ts's full pipeline (Discovery/Outreach/Follow-Ups/
 * Replies). Split out (Gavin, 2026-09-10) because the two have opposite
 * constraints: SalesManager.runAll() is deliberately LLM-free (arithmetic
 * over real KPI data, spec'd that way from Phase 9) and costs zero Groq
 * tokens on a normal cycle, so it can run often without hitting Groq's
 * free-tier daily token cap (200k TPD) — but Discovery/Research/
 * Qualification are real LLM calls per candidate, and bundling both into
 * one frequent schedule (they were, briefly, both on the same every-
 * 15-minute cron) exhausted the daily quota by early afternoon, then sat failing
 * with 429s for the rest of the day on every subsequent run. A goal set
 * through the Sales Manager chat deserves a fast reaction; Discovery
 * doesn't need to re-run every 15 minutes to get one.
 *
 * Note this isn't perfectly token-free: if the Manager decides a
 * bottleneck needs more discovery volume (an in-authority
 * discovery_increase), it calls the same real discovery.run() run-cycle.ts
 * does — real tokens, but only on the cycles that actually decide to act,
 * not every cycle regardless of need.
 *
 * Run with: npm run cycle:manager
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";

import { AgentRuntime } from "../runtime/agent-runtime.js";
import { ModelRouter } from "../runtime/model-router.js";
import { GroqProvider } from "../runtime/model-providers/groq.js";
import { PostgresTokenBudget } from "../runtime/token-budget.js";
import { AnthropicProvider } from "../runtime/model-providers/anthropic.js";
import { ToolRegistry } from "../runtime/tool-registry.js";
import { DefaultPolicyEngine } from "../runtime/policy-engine.js";
import { DEFAULT_POLICY_RULES } from "../policy/default-rules.js";
import { PostgresAuditSink } from "../db/postgres-audit-sink.js";

import { createSearchGooglePlacesTool } from "../tools/search-google-places.js";
import { createFindDuplicateCompanyTool } from "../tools/find-duplicate-company.js";
import { createFetchWebsiteTextTool } from "../tools/fetch-website-text.js";
import { createPersistDiscoveredCompanyTool } from "../tools/persist-discovered-company.js";
import { createCreateEscalationTaskTool } from "../tools/create-escalation-task.js";
import { createNotifyGavinTool } from "../tools/notify-gavin.js";

import { DiscoverResearchQualifyPipeline } from "../pipelines/discover-research-qualify.js";

import { PostgresGoalStore } from "../goals/goal-store.js";
import { PostgresKpiSnapshotStore } from "../goals/kpi-snapshot-store.js";
import { PostgresForecastStore } from "../goals/forecast-store.js";
import { PostgresManagerDecisionStore } from "../goals/manager-decision-store.js";
import { PostgresExperimentStore } from "../experiments/experiment-store.js";
import { PostgresFunnelReader } from "../db/hartwich-os/funnel-reader.js";
import { PostgresAgentHealthReader } from "../db/agent-health-reader.js";
import { PostgresAnalyticsReader } from "../db/analytics-reader.js";
import { SalesManager } from "../manager/sales-manager.js";

const REQUIRED_ENV = ["AGENT_DATABASE_URL", "HARTWICH_DATABASE_URL", "GROQ_API_KEY"] as const;

function preflight() {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(
      `Missing required env var(s): ${missing.join(", ")}. Copy .env.example to .env.local and fill them in before running for real.`
    );
    process.exit(1);
  }
  process.env.GAVIN_EMAIL ??= "gavinhartwich@gmail.com";
  if (!process.env.GOOGLE_PLACES_API_KEY) {
    console.warn("  ⚠ GOOGLE_PLACES_API_KEY not set — an in-authority discovery_increase decision this cycle would fail.");
  }
}

async function main() {
  console.log(`Hartwich AI Sales Manager — cycle ${randomUUID()} starting ${new Date().toISOString()}`);
  preflight();

  // Only what discovery.run() (called if the Manager decides to increase
  // volume) and the Manager's own tools (escalation) actually need —
  // deliberately not the outreach/follow-up/reply tool set, since this
  // entrypoint never runs those stages.
  const tools = new ToolRegistry()
    .register(createSearchGooglePlacesTool())
    .register(createFindDuplicateCompanyTool())
    .register(createFetchWebsiteTextTool())
    .register(createPersistDiscoveredCompanyTool())
    .register(createCreateEscalationTaskTool())
    .register(createNotifyGavinTool());

  const policy = new DefaultPolicyEngine(DEFAULT_POLICY_RULES);
  const audit = new PostgresAuditSink();
  // Shares the agents' daily budget: an in-authority discovery_increase runs
  // the same real discovery pipeline, so it has to respect the same ceiling.
  const budget = new PostgresTokenBudget();
  const fast = new GroqProvider({ onUsage: (usage) => budget.record(usage) });
  const strong = process.env.ANTHROPIC_API_KEY ? new AnthropicProvider() : fast;
  const runtime = new AgentRuntime({ modelRouter: new ModelRouter({ fast, strong }), tools, policy, audit });

  const discovery = new DiscoverResearchQualifyPipeline({ runtime, tools, policy, audit, budget });

  const manager = new SalesManager({
    goals: new PostgresGoalStore(),
    funnel: new PostgresFunnelReader(),
    agentHealth: new PostgresAgentHealthReader(),
    analytics: new PostgresAnalyticsReader(),
    kpiSnapshots: new PostgresKpiSnapshotStore(),
    forecasts: new PostgresForecastStore(),
    decisions: new PostgresManagerDecisionStore(),
    experiments: new PostgresExperimentStore(),
    discovery,
    tools,
    policy,
  });

  try {
    const results = await manager.runAll();
    if (results.length === 0) {
      console.log("No active goals.");
    }
    for (const r of results) {
      console.log(`  ${r.metric} (${r.status}, ${r.intensity}): ${r.selectedAction} → ${r.execution.kind}`);
    }
  } catch (err) {
    console.error("Sales Manager cycle failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }

  console.log(`\nCycle finished ${new Date().toISOString()}`);
}

main()
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exitCode = 1;
  })
  .finally(() => {
    // See run-cycle.ts's own comment — same reasoning, same fix.
    process.exit(process.exitCode ?? 0);
  });
