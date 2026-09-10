/**
 * The real deployment entrypoint — runs one full cycle of every pipeline
 * against REAL credentials (AGENT_DATABASE_URL, HARTWICH_DATABASE_URL,
 * Gmail, Google Places, Groq, and — where an agent's `modelLane` is
 * "strong" — Anthropic), instead of the fixtures every `npm run demo:*`
 * script uses. This is the piece the README's "What's next" section
 * flagged as missing: every store/reader/tool below is already real
 * (`Postgres*`, `Google*`) — this script is what actually wires them
 * together and gives them somewhere to run from (cron, see
 * .github/workflows/cron.yml).
 *
 * Order matters: discover before outreach (new leads need to exist
 * before they can be contacted), outreach before replies (nothing to
 * reply to otherwise), and the Sales Manager last (SPEC.md's own
 * ordering — it needs the KPI data everything above produces).
 *
 * Each stage is independently try/caught and logged — one stage failing
 * (e.g. Gmail token expired) must not stop the others from running.
 *
 * Run with: npm run cycle
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";

import { AgentRuntime } from "../runtime/agent-runtime.js";
import { ModelRouter } from "../runtime/model-router.js";
import { GroqProvider } from "../runtime/model-providers/groq.js";
import { AnthropicProvider } from "../runtime/model-providers/anthropic.js";
import { ToolRegistry } from "../runtime/tool-registry.js";
import { DefaultPolicyEngine } from "../runtime/policy-engine.js";
import { DEFAULT_POLICY_RULES } from "../policy/default-rules.js";
import { PostgresAuditSink } from "../db/postgres-audit-sink.js";

import { createSearchGooglePlacesTool } from "../tools/search-google-places.js";
import { createFindDuplicateCompanyTool } from "../tools/find-duplicate-company.js";
import { createFetchWebsiteTextTool } from "../tools/fetch-website-text.js";
import { createPersistDiscoveredCompanyTool } from "../tools/persist-discovered-company.js";
import { createGetOutreachTargetTool } from "../tools/get-outreach-target.js";
import { createCreateEmailDraftTool } from "../tools/create-email-draft.js";
import { createSendEmailTool } from "../tools/send-email.js";
import { createRecordOutboundEmailTool } from "../tools/record-outbound-email.js";
import { createGetFollowUpCandidatesTool } from "../tools/get-followup-candidates.js";
import { createGetUnreadRepliesTool } from "../tools/get-unread-replies.js";
import { createMarkEmailReadTool } from "../tools/mark-email-read.js";
import { createRecordInboundReplyTool } from "../tools/record-inbound-reply.js";
import { createCloseDealLostTool } from "../tools/close-deal-lost.js";
import { createAppendCompanyNoteTool } from "../tools/append-company-note.js";
import { createFlagDealForReviewTool } from "../tools/flag-deal-for-review.js";
import { createCreateEscalationTaskTool } from "../tools/create-escalation-task.js";
import { createNotifyGavinTool } from "../tools/notify-gavin.js";
import { createGetNewLeadCandidatesTool, defaultList as listNewLeadCandidates } from "../tools/get-new-lead-candidates.js";

import { PostgresOptOutStore } from "../outreach/opt-out-store.js";
import { PostgresOutreachControlStore } from "../outreach/outreach-control-store.js";
import { PostgresEmailAccountsStore } from "../db/hartwich-os/email-accounts-store.js";

import { DiscoverResearchQualifyPipeline } from "../pipelines/discover-research-qualify.js";
import { ExecuteOutreachPipeline } from "../pipelines/execute-outreach.js";
import { SendFollowUpsPipeline } from "../pipelines/send-followups.js";
import { HandleInboundRepliesPipeline } from "../pipelines/handle-inbound-replies.js";

import { PostgresGoalStore } from "../goals/goal-store.js";
import { PostgresKpiSnapshotStore } from "../goals/kpi-snapshot-store.js";
import { PostgresForecastStore } from "../goals/forecast-store.js";
import { PostgresManagerDecisionStore } from "../goals/manager-decision-store.js";
import { PostgresExperimentStore } from "../experiments/experiment-store.js";
import { PostgresFunnelReader } from "../db/hartwich-os/funnel-reader.js";
import { PostgresAgentHealthReader } from "../db/agent-health-reader.js";
import { PostgresAnalyticsReader } from "../db/analytics-reader.js";
import { DEFAULT_DISCOVERY_TARGETS } from "../config/icp-targets.js";
import { SalesManager } from "../manager/sales-manager.js";

const REQUIRED_ENV = ["AGENT_DATABASE_URL", "HARTWICH_DATABASE_URL", "GROQ_API_KEY"] as const;
const OPTIONAL_ENV_WARNINGS: Record<string, string> = {
  ANTHROPIC_API_KEY: "strong-lane agent calls (research, Sales Manager reasoning) will fall back to erroring, not to Groq — set it or those steps will fail.",
  GOOGLE_PLACES_API_KEY: "Prospect Discovery will fail — no new leads will be found this cycle.",
  GMAIL_CLIENT_ID: "sending/reading Gmail will fail — outreach, follow-ups, and reply handling will fail this cycle.",
  GAVIN_EMAIL: "escalation emails have no destination — defaulting to gavinhartwich@gmail.com.",
};

function preflight() {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(
      `Missing required env var(s): ${missing.join(", ")}. Copy .env.example to .env.local and fill them in before running a real cycle.`
    );
    process.exit(1);
  }
  process.env.GAVIN_EMAIL ??= "gavinhartwich@gmail.com";
  for (const [key, warning] of Object.entries(OPTIONAL_ENV_WARNINGS)) {
    if (!process.env[key]) console.warn(`  ⚠ ${key} not set — ${warning}`);
  }
}

async function runStage<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  console.log(`\n▶ ${name}`);
  try {
    const result = await fn();
    console.log(`✓ ${name} done`);
    return result;
  } catch (err) {
    console.error(`✗ ${name} failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

async function main() {
  console.log(`Hartwich AI Sales Workforce — cycle ${randomUUID()} starting ${new Date().toISOString()}`);
  preflight();

  const tools = new ToolRegistry()
    .register(createSearchGooglePlacesTool())
    .register(createFindDuplicateCompanyTool())
    .register(createFetchWebsiteTextTool())
    .register(createPersistDiscoveredCompanyTool())
    .register(createGetOutreachTargetTool())
    .register(createCreateEmailDraftTool())
    .register(createSendEmailTool())
    .register(createRecordOutboundEmailTool())
    .register(createGetFollowUpCandidatesTool())
    .register(createGetUnreadRepliesTool())
    .register(createMarkEmailReadTool())
    .register(createRecordInboundReplyTool())
    .register(createCloseDealLostTool())
    .register(createAppendCompanyNoteTool())
    .register(createFlagDealForReviewTool())
    .register(createCreateEscalationTaskTool())
    .register(createNotifyGavinTool())
    .register(createGetNewLeadCandidatesTool());

  const policy = new DefaultPolicyEngine(DEFAULT_POLICY_RULES);
  const audit = new PostgresAuditSink();
  const fast = new GroqProvider();
  const strong = process.env.ANTHROPIC_API_KEY ? new AnthropicProvider() : fast;
  const runtime = new AgentRuntime({ modelRouter: new ModelRouter({ fast, strong }), tools, policy, audit });

  const optOuts = new PostgresOptOutStore();
  const control = new PostgresOutreachControlStore();
  const accounts = new PostgresEmailAccountsStore();
  const outreachDeps = { runtime, tools, policy, optOuts, control, accounts };

  const discovery = new DiscoverResearchQualifyPipeline({ runtime, tools, policy, audit });
  const execute = new ExecuteOutreachPipeline(outreachDeps);
  const followups = new SendFollowUpsPipeline(outreachDeps);
  const replies = new HandleInboundRepliesPipeline(outreachDeps);

  // 1. Prospect Discovery — every configured ICP target (src/config/icp-targets.ts).
  await runStage("Prospect Discovery", async () => {
    for (const target of DEFAULT_DISCOVERY_TARGETS) {
      const summary = await discovery.run(target);
      console.log(`  ${target.area} / "${target.keyword}": ${summary.found} found — ${summary.results.map((r) => r.outcome).join(", ") || "none"}`);
    }
  });

  // 2. Outreach Execution — every qualified-but-uncontacted lead.
  await runStage("Outreach Execution", async () => {
    const candidates = await listNewLeadCandidates();
    console.log(`  ${candidates.length} New Lead candidate(s)`);
    for (const companyId of candidates) {
      const result = await execute.run(companyId);
      console.log(`  ${companyId}: ${result.outcome}`);
    }
  });

  // 3. Follow-Ups — deals in Contacted with no reply, due per cadence.
  await runStage("Follow-Ups", async () => {
    const results = await followups.runAll();
    console.log(`  ${results.length} candidate(s): ${results.map((r) => r.outcome).join(", ") || "none"}`);
  });

  // 4. Inbound Replies — classify + respond/escalate.
  await runStage("Inbound Replies", async () => {
    const results = await replies.runAll();
    console.log(`  ${results.length} unread repl(y/ies): ${results.map((r) => r.outcome).join(", ") || "none"}`);
  });

  // 5. Sales Manager — last, per SPEC.md's own ordering: it needs the KPI
  // data every stage above just produced.
  await runStage("Sales Manager", async () => {
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
    const results = await manager.runAll();
    for (const r of results) {
      console.log(`  ${r.metric} (${r.status}, ${r.intensity}): ${r.selectedAction} → ${r.execution.kind}`);
    }
  });

  console.log(`\nCycle finished ${new Date().toISOString()}`);
}

main().catch((err) => {
  console.error("Fatal error outside any stage:", err);
  process.exitCode = 1;
});
