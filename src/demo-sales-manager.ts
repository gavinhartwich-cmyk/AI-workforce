/**
 * Phase 9 demo — the Sales Manager's control loop (SPEC.md §55 Phase 9:
 * "GOAL → PLAN → DELEGATE → EXECUTE → MEASURE → OPTIMIZE"), against
 * fixtures (no AGENT_DATABASE_URL/HARTWICH_DATABASE_URL/GAVIN_EMAIL
 * credentials needed — this fakes the escalation email/task too).
 *
 * Two goals, two outcomes:
 *  1. "prospects_discovered" is a bit behind pace (work intensity BEHIND)
 *     with an upstream funnel gap -> the manager autonomously asks for
 *     20% more Prospect Discovery volume — within its own authority, no
 *     approval needed, and it actually runs the discovery pipeline.
 *  2. "new_clients" is badly behind (CRITICAL) with the same kind of gap
 *     -> the size of ask that would actually help (100% more volume)
 *     exceeds the manager's 20% autonomous cap, so it escalates to Gavin
 *     instead — SPEC.md §37's exact format — rather than either
 *     overstepping its authority or doing nothing.
 *
 * Run with: npm run demo:sales-manager
 */
import "dotenv/config";
import { ToolRegistry } from "./runtime/tool-registry.js";
import { DefaultPolicyEngine } from "./runtime/policy-engine.js";
import { DEFAULT_POLICY_RULES } from "./policy/default-rules.js";
import { createNotifyGavinTool } from "./tools/notify-gavin.js";
import { createCreateEscalationTaskTool } from "./tools/create-escalation-task.js";
import { NotImplementedWriteStore } from "./db/hartwich-os/write-store-stub.js";
import type { CreateTaskInput } from "./db/hartwich-os/write-store.js";
import type { GmailSender, SendEmailInput, SendEmailResult } from "./integrations/gmail.js";
import type { GoalStore } from "./goals/goal-store.js";
import type { FunnelReader } from "./db/hartwich-os/funnel-reader.js";
import type { AgentHealthReader } from "./db/agent-health-reader.js";
import type { AnalyticsReader } from "./db/analytics-reader.js";
import type { KpiSnapshotStore } from "./goals/kpi-snapshot-store.js";
import type { ForecastStore } from "./goals/forecast-store.js";
import type { ManagerDecisionStore } from "./goals/manager-decision-store.js";
import type { ExperimentStore, CreateExperimentInput } from "./experiments/experiment-store.js";
import type { Experiment } from "./experiments/types.js";
import type { DiscoverResearchQualifyInput, PipelineSummary } from "./pipelines/discover-research-qualify.js";
import type { ManagerDecision, SalesGoal } from "./goals/types.js";
import { SalesManager } from "./manager/sales-manager.js";

process.env.GAVIN_EMAIL ??= "gavinhartwich@gmail.com";

const PERIOD_START = new Date("2026-09-01T00:00:00Z");
const PERIOD_END = new Date("2026-10-01T00:00:00Z");
const AS_OF = new Date("2026-09-16T00:00:00Z"); // day 15 of 30

// Same funnel shape as demo-goal-status.ts and demo-sales-analyst.ts —
// discovery and qualification are working, but nothing's been contacted
// yet, so qualified_prospects -> contacted is the real, code-diagnosable
// gap both goals below share.
const GOALS: SalesGoal[] = [
  {
    id: "goal-discovery",
    metric: "prospects_discovered",
    target: 100, // 40 discovered at day 15/30 of 100 -> expectedByNow 50, ratio 0.8 -> AT_RISK -> BEHIND
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    priority: "high",
    constraints: null,
    status: "NOT_STARTED",
    createdAt: PERIOD_START,
    updatedAt: PERIOD_START,
  },
  {
    id: "goal-clients",
    metric: "new_clients",
    target: 10, // 0 clients so far -> CRITICAL regardless of target
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    priority: "critical",
    constraints: null,
    status: "NOT_STARTED",
    createdAt: PERIOD_START,
    updatedAt: PERIOD_START,
  },
];

class FixedGoalStore implements GoalStore {
  async create(): Promise<SalesGoal> {
    throw new Error("not used in this demo");
  }
  async get(id: string) {
    return GOALS.find((g) => g.id === id) ?? null;
  }
  async listActive() {
    return GOALS;
  }
  async updateStatus(id: string, status: SalesGoal["status"]) {
    console.log(`  (would update ${id} status → ${status})`);
  }
}

class FixtureFunnelReader implements FunnelReader {
  async countCompaniesCreated() {
    return 40;
  }
  async countCompaniesByStatus(status: "qualified" | "needs_review" | "disqualified") {
    return status === "qualified" ? 18 : 0;
  }
  async countDealsCreated() {
    return 18;
  }
  async countDealsByStageName() {
    return 0; // nothing contacted yet
  }
  async countDealsWon() {
    return 0;
  }
  async sumWonDealValue() {
    return 0;
  }
  async countDealsLost() {
    return 0;
  }
  async countAuditAction() {
    return 0;
  }
}

class FixtureAgentHealthReader implements AgentHealthReader {
  async getSuccessRate() {
    return { total: 42, succeeded: 40 };
  }
}

class FixtureAnalyticsReader implements AnalyticsReader {
  async countPositiveConversations() {
    return 0;
  }
  async countOptOuts() {
    return 0;
  }
}

class QuietKpiSnapshotStore implements KpiSnapshotStore {
  async record() {}
}
class QuietForecastStore implements ForecastStore {
  async record() {}
}

class PrintingManagerDecisionStore implements ManagerDecisionStore {
  async record(decision: ManagerDecision) {
    console.log(`  Manager decision recorded: "${decision.selectedAction}"`);
    return "demo-decision";
  }
  async list() {
    return [];
  }
}

class InMemoryExperimentStore implements ExperimentStore {
  experiments: Experiment[] = [];
  async create(input: CreateExperimentInput): Promise<Experiment> {
    const experiment: Experiment = {
      id: `experiment-${this.experiments.length + 1}`,
      name: input.name,
      description: input.description,
      minSampleSizePerVariant: input.minSampleSizePerVariant,
      status: "running",
      createdAt: new Date(),
      variants: input.variants.map((v, i) => ({ id: `variant-${i}`, ...v })),
    };
    this.experiments.push(experiment);
    return experiment;
  }
  async get(id: string) {
    return this.experiments.find((e) => e.id === id) ?? null;
  }
  async listRunning() {
    return this.experiments.filter((e) => e.status === "running");
  }
  async updateStatus(id: string, status: Experiment["status"]) {
    const e = this.experiments.find((x) => x.id === id);
    if (e) e.status = status;
  }
}

class PrintingDiscoveryPipeline {
  async run(input: DiscoverResearchQualifyInput): Promise<PipelineSummary> {
    console.log(`  → would run Prospect Discovery: area="${input.area}", keyword="${input.keyword}", maxResults=${input.maxResults}`);
    return { found: 0, results: [] };
  }
}

class PrintingGmailSender implements GmailSender {
  async send(input: SendEmailInput): Promise<SendEmailResult> {
    console.log(`\n  → ESCALATION EMAIL to ${input.to}:\n${input.body.replace(/^/gm, "    ")}\n`);
    return { messageId: "demo-msg-1", fromAddress: "hartwichlabs@gmail.com", threadId: null };
  }
}

class PrintingWriteStore extends NotImplementedWriteStore {
  async createTask(input: CreateTaskInput) {
    console.log(`  → would create a hartwich-os task due ${input.dueDate.toISOString()}: "${input.description}"`);
    return { taskId: "demo-task-1" };
  }
}

async function main() {
  const tools = new ToolRegistry()
    .register(createNotifyGavinTool(new PrintingGmailSender()))
    .register(createCreateEscalationTaskTool(new PrintingWriteStore()));
  const policy = new DefaultPolicyEngine(DEFAULT_POLICY_RULES);

  const manager = new SalesManager({
    goals: new FixedGoalStore(),
    funnel: new FixtureFunnelReader(),
    agentHealth: new FixtureAgentHealthReader(),
    analytics: new FixtureAnalyticsReader(),
    kpiSnapshots: new QuietKpiSnapshotStore(),
    forecasts: new QuietForecastStore(),
    decisions: new PrintingManagerDecisionStore(),
    experiments: new InMemoryExperimentStore(),
    discovery: new PrintingDiscoveryPipeline(),
    tools,
    policy,
  });

  const results = await manager.runAll(AS_OF);

  for (const result of results) {
    console.log(`\nGOAL: ${result.metric} (${result.status}, work intensity ${result.intensity})`);
    console.log(`SELECTED ACTION: ${result.selectedAction}`);
    console.log(`EXECUTED: ${result.execution.kind}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
