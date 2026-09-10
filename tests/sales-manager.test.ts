import { describe, expect, it } from "vitest";
import { SalesManager } from "../src/manager/sales-manager.js";
import { ToolRegistry } from "../src/runtime/tool-registry.js";
import { DefaultPolicyEngine } from "../src/runtime/policy-engine.js";
import { DEFAULT_POLICY_RULES } from "../src/policy/default-rules.js";
import { createNotifyGavinTool } from "../src/tools/notify-gavin.js";
import { createCreateEscalationTaskTool } from "../src/tools/create-escalation-task.js";
import { NotImplementedWriteStore } from "../src/db/hartwich-os/write-store-stub.js";
import type { CreateTaskInput } from "../src/db/hartwich-os/write-store.js";
import type { GmailSender, SendEmailInput, SendEmailResult } from "../src/integrations/gmail.js";
import type { GoalStore } from "../src/goals/goal-store.js";
import type { FunnelReader } from "../src/db/hartwich-os/funnel-reader.js";
import type { AgentHealthReader } from "../src/db/agent-health-reader.js";
import type { AnalyticsReader } from "../src/db/analytics-reader.js";
import type { KpiSnapshotStore } from "../src/goals/kpi-snapshot-store.js";
import type { ForecastStore } from "../src/goals/forecast-store.js";
import type { ManagerDecisionStore } from "../src/goals/manager-decision-store.js";
import type { ExperimentStore, CreateExperimentInput } from "../src/experiments/experiment-store.js";
import type { Experiment } from "../src/experiments/types.js";
import type { DiscoverResearchQualifyInput, PipelineSummary } from "../src/pipelines/discover-research-qualify.js";
import { BASE_DISCOVERY_VOLUME, type DiscoveryTarget } from "../src/config/icp-targets.js";
import type { ManagerDecision, SalesGoal } from "../src/goals/types.js";
import type {
  EscalationStore,
  ManagerEscalation,
  NewManagerEscalation,
} from "../src/manager/escalation-store.js";

process.env.GAVIN_EMAIL = "gavinhartwich@gmail.com";

const PERIOD_START = new Date("2026-09-01T00:00:00Z");
const PERIOD_END = new Date("2026-10-01T00:00:00Z"); // 30 days
const AS_OF = new Date("2026-09-16T00:00:00Z"); // day 15 of 30

function buildGoal(overrides: Partial<SalesGoal> = {}): SalesGoal {
  return {
    id: "goal-1",
    metric: "new_clients",
    target: 10,
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    priority: "high",
    constraints: null,
    status: "NOT_STARTED",
    createdAt: PERIOD_START,
    updatedAt: PERIOD_START,
    ...overrides,
  };
}

class FakeGoalStore implements GoalStore {
  constructor(private goals: SalesGoal[]) {}
  async create(): Promise<SalesGoal> {
    throw new Error("not used in this test");
  }
  async get(id: string) {
    return this.goals.find((g) => g.id === id) ?? null;
  }
  async listActive() {
    return this.goals;
  }
  async updateStatus() {}
}

type FunnelCounts = {
  prospects?: number;
  qualified?: number;
  byStage?: Record<string, number>;
  won?: number;
  wonValue?: number;
  lost?: number;
};

class FakeFunnelReader implements FunnelReader {
  constructor(private counts: FunnelCounts = {}) {}
  async countCompaniesCreated() {
    return this.counts.prospects ?? 0;
  }
  async countCompaniesByStatus() {
    return this.counts.qualified ?? 0;
  }
  async countDealsCreated() {
    return this.counts.qualified ?? 0;
  }
  async countDealsByStageName(stageName: string) {
    return this.counts.byStage?.[stageName] ?? 0;
  }
  async countDealsWon() {
    return this.counts.won ?? 0;
  }
  async sumWonDealValue() {
    return this.counts.wonValue ?? 0;
  }
  async countDealsLost() {
    return this.counts.lost ?? 0;
  }
  async countAuditAction() {
    return 0;
  }
}

class FakeAgentHealthReader implements AgentHealthReader {
  async getSuccessRate() {
    return { total: 10, succeeded: 9 };
  }
}

class FakeAnalyticsReader implements AnalyticsReader {
  async countPositiveConversations() {
    return 0;
  }
  async countOptOuts() {
    return 0;
  }
}

class NoopKpiSnapshotStore implements KpiSnapshotStore {
  async record() {}
}
class NoopForecastStore implements ForecastStore {
  async record() {}
}

class RecordingManagerDecisionStore implements ManagerDecisionStore {
  records: ManagerDecision[] = [];
  async record(decision: ManagerDecision): Promise<string> {
    this.records.push(decision);
    return `decision-${this.records.length}`;
  }
  async list(): Promise<ManagerDecision[]> {
    return this.records;
  }
}

class FakeExperimentStore implements ExperimentStore {
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

class FakeDiscoveryPipeline {
  calls: DiscoverResearchQualifyInput[] = [];
  async run(input: DiscoverResearchQualifyInput): Promise<PipelineSummary> {
    this.calls.push(input);
    return { found: input.maxResults ?? 0, results: [] };
  }
}

class FakeGmailSender implements GmailSender {
  sent: SendEmailInput[] = [];
  async send(input: SendEmailInput): Promise<SendEmailResult> {
    this.sent.push(input);
    return { messageId: "msg-1", fromAddress: "hartwichlabs@gmail.com", threadId: null };
  }
}

class FakeWriteStore extends NotImplementedWriteStore {
  tasksCreated: CreateTaskInput[] = [];
  async createTask(input: CreateTaskInput) {
    this.tasksCreated.push(input);
    return { taskId: `task-${this.tasksCreated.length}` };
  }
}

/** In-memory EscalationStore so the dedup/approval paths are testable without Postgres. */
class FakeEscalationStore implements EscalationStore {
  raised: ManagerEscalation[] = [];
  private seq = 0;

  constructor(private preexisting: ManagerEscalation[] = []) {
    this.raised = [...preexisting];
  }

  async findPending(goalId: string, capability: string) {
    return (
      this.raised.find((e) => e.goalId === goalId && e.capability === capability && e.status === "pending") ?? null
    );
  }
  async listApproved() {
    return this.raised.filter((e) => e.status === "approved");
  }
  async raise(escalation: NewManagerEscalation): Promise<ManagerEscalation> {
    const row: ManagerEscalation = {
      ...escalation,
      id: `esc-${++this.seq}`,
      status: "pending",
      executionNote: null,
      createdAt: new Date(),
      decidedAt: null,
      executedAt: null,
    };
    this.raised.push(row);
    return row;
  }
  async markExecuted(id: string, note: string | null, at: Date) {
    const row = this.raised.find((e) => e.id === id);
    if (row) Object.assign(row, { status: "executed", executionNote: note, executedAt: at });
  }
  async markFailed(id: string, note: string, at: Date) {
    const row = this.raised.find((e) => e.id === id);
    if (row) Object.assign(row, { status: "failed", executionNote: note, executedAt: at });
  }
}

function buildManager(opts: {
  goals: SalesGoal[];
  funnelCounts?: FunnelCounts;
  discovery?: FakeDiscoveryPipeline;
  experiments?: FakeExperimentStore;
  /** Explicit so these tests stay decoupled from the real, rotating
   * North-America target list (src/config/icp-targets.ts) — that's
   * business config, not something a unit test should be coupled to. */
  discoveryTargets?: DiscoveryTarget[];
  escalations?: FakeEscalationStore;
}) {
  const decisions = new RecordingManagerDecisionStore();
  const experiments = opts.experiments ?? new FakeExperimentStore();
  const discovery = opts.discovery ?? new FakeDiscoveryPipeline();
  const gmailSender = new FakeGmailSender();
  const writeStore = new FakeWriteStore();

  const tools = new ToolRegistry()
    .register(createNotifyGavinTool(gmailSender))
    .register(createCreateEscalationTaskTool(writeStore));
  const policy = new DefaultPolicyEngine(DEFAULT_POLICY_RULES);

  const manager = new SalesManager({
    goals: new FakeGoalStore(opts.goals),
    funnel: new FakeFunnelReader(opts.funnelCounts),
    agentHealth: new FakeAgentHealthReader(),
    analytics: new FakeAnalyticsReader(),
    kpiSnapshots: new NoopKpiSnapshotStore(),
    forecasts: new NoopForecastStore(),
    decisions,
    experiments,
    escalations: opts.escalations,
    discovery,
    tools,
    policy,
    discoveryTargets: opts.discoveryTargets ?? [{ area: "Winnipeg, MB", keyword: "HVAC contractor" }],
  });

  return { manager, decisions, experiments, discovery, gmailSender, writeStore, escalations: opts.escalations };
}

describe("SalesManager", () => {
  it("takes no action when the goal is on pace", async () => {
    const { manager, decisions } = buildManager({
      goals: [buildGoal({ target: 1 })],
      funnelCounts: { prospects: 10, qualified: 10, won: 1, wonValue: 1000 }, // ACHIEVED
    });

    const result = await manager.runCycle("goal-1", AS_OF);

    expect(result.intensity).toBe("NORMAL");
    expect(result.execution).toEqual({ kind: "none" });
    expect(decisions.records).toHaveLength(1);
    expect(decisions.records[0].options).toEqual([]);
  });

  it("autonomously increases discovery volume for an upstream bottleneck within its 20% authority cap", async () => {
    // metric prospects_discovered, target 250, halfway through the period
    // -> expectedByNow 125, paceRatio 100/125 = 0.8 -> exactly AT_RISK ->
    // work intensity BEHIND. Same funnel shape as the proven bottleneck
    // fixture (won stays 0 — a nonzero won count with zero contacted deals
    // is an internally-impossible funnel, which correctly yields no
    // diagnosable bottleneck rather than a paradoxical one).
    const { manager, decisions, discovery, gmailSender } = buildManager({
      goals: [buildGoal({ metric: "prospects_discovered", target: 250 })],
      funnelCounts: { prospects: 100, qualified: 50, won: 0, wonValue: 0 },
    });

    const result = await manager.runCycle("goal-1", AS_OF);

    expect(result.intensity).toBe("BEHIND");
    expect(result.execution.kind).toBe("discovery_increase");
    expect(discovery.calls).toHaveLength(1);
    expect(discovery.calls[0].maxResults).toBe(24); // BASE_DISCOVERY_VOLUME(20) * 1.2, intensity BEHIND -> +20%
    expect(gmailSender.sent).toHaveLength(0); // no escalation needed — this was in-authority
    expect(decisions.records[0].selectedAction).toMatch(/Increase Prospect Discovery volume/);
  });

  it("escalates to Gavin when the needed discovery increase exceeds autonomous authority", async () => {
    const { manager, decisions, discovery, gmailSender, writeStore } = buildManager({
      goals: [buildGoal({ target: 1000 })], // huge target relative to progress -> CRITICAL -> wants +100%, exceeds the 20% cap
      funnelCounts: { prospects: 100, qualified: 50, won: 0, wonValue: 0 },
    });

    const result = await manager.runCycle("goal-1", AS_OF);

    expect(result.intensity).toBe("CRITICAL");
    expect(result.execution.kind).toBe("escalated");
    expect(discovery.calls).toHaveLength(0); // never fired — exceeded authority
    expect(gmailSender.sent).toHaveLength(1);
    expect(gmailSender.sent[0].body).toMatch(/GAVIN — DECISION REQUIRED/);
    expect(gmailSender.sent[0].body).toMatch(/WHY APPROVAL IS REQUIRED/);
    expect(writeStore.tasksCreated).toHaveLength(1);
    expect(decisions.records[0].options).toHaveLength(2);
    expect(decisions.records[0].options[1].action).toBe("Escalate to Gavin");
  });

  it("raises one escalation and does not duplicate it on later cycles", async () => {
    // The bug this fixes: with no record of an open ask, every cycle
    // re-diagnosed the same bottleneck and filed another task + email —
    // 7 identical ones in one afternoon on the 15-minute schedule.
    const escalations = new FakeEscalationStore();
    const { manager, gmailSender, writeStore } = buildManager({
      goals: [buildGoal({ target: 1000 })],
      funnelCounts: { prospects: 100, qualified: 50, won: 0, wonValue: 0 },
      escalations,
    });

    await manager.runCycle("goal-1", AS_OF);
    await manager.runCycle("goal-1", AS_OF);
    await manager.runCycle("goal-1", AS_OF);

    expect(escalations.raised).toHaveLength(1);
    expect(escalations.raised[0].status).toBe("pending");
    expect(escalations.raised[0].capability).toBe("discover_prospects");
    expect(escalations.raised[0].proposedChangePercent).toBe(100);
    // The noisy side effects are suppressed along with the duplicate.
    expect(gmailSender.sent).toHaveLength(1);
    expect(writeStore.tasksCreated).toHaveLength(1);
  });

  it("carries out an approved escalation at the percentage Gavin approved", async () => {
    const approved: ManagerEscalation = {
      id: "esc-approved",
      goalId: "goal-1",
      capability: "discover_prospects",
      proposedChangePercent: 100,
      action: "Increase Prospect Discovery volume by 100%.",
      diagnosis: "d",
      whyApprovalRequired: "Exceeds the 20% autonomous cap.",
      expectedImpact: 0.01,
      risk: 0.3,
      status: "approved",
      executionNote: null,
      createdAt: AS_OF,
      decidedAt: AS_OF,
      executedAt: null,
    };
    const escalations = new FakeEscalationStore([approved]);
    const discovery = new FakeDiscoveryPipeline();
    const { manager } = buildManager({
      goals: [buildGoal({ target: 1000 })],
      funnelCounts: { prospects: 100, qualified: 50, won: 0, wonValue: 0 },
      discovery,
      escalations,
    });

    await manager.runAll(AS_OF);

    // Ran at +100% — the very thing the authority cap refused on its own,
    // now allowed because a human said yes.
    expect(discovery.calls.length).toBeGreaterThan(0);
    expect(discovery.calls[0].maxResults).toBe(BASE_DISCOVERY_VOLUME * 2);
    expect(escalations.raised.find((e) => e.id === "esc-approved")!.status).toBe("executed");
  });

  it("marks an approved escalation failed when nothing can carry out that capability", async () => {
    const approved: ManagerEscalation = {
      id: "esc-odd",
      goalId: "goal-1",
      capability: "rewrite_the_offer",
      proposedChangePercent: null,
      action: "Rewrite the offer.",
      diagnosis: "d",
      whyApprovalRequired: "No policy covers it.",
      expectedImpact: null,
      risk: null,
      status: "approved",
      executionNote: null,
      createdAt: AS_OF,
      decidedAt: AS_OF,
      executedAt: null,
    };
    const escalations = new FakeEscalationStore([approved]);
    const { manager } = buildManager({ goals: [buildGoal({ target: 1 })], escalations });

    await manager.runAll(AS_OF);

    const row = escalations.raised.find((e) => e.id === "esc-odd")!;
    expect(row.status).toBe("failed");
    expect(row.executionNote).toMatch(/No executor wired/);
  });

  it("starts a controlled experiment for a downstream conversion bottleneck", async () => {
    const { manager, experiments, gmailSender } = buildManager({
      goals: [buildGoal({ target: 10 })],
      // Upstream conversions all meet/exceed target; contacted -> engaged is the real gap.
      funnelCounts: {
        prospects: 100,
        qualified: 60,
        byStage: { Contacted: 54, Engaged: 2, "Meeting Booked": 1, "Proposal Sent": 1 },
        won: 1,
        wonValue: 5000,
      },
    });

    const result = await manager.runCycle("goal-1", AS_OF);

    expect(result.execution.kind).toBe("experiment_created");
    expect(experiments.experiments).toHaveLength(1);
    expect(experiments.experiments[0].variants.map((v) => v.name)).toEqual(["control", "test"]);
    expect(gmailSender.sent).toHaveLength(0);
  });

  it("escalates instead of stacking a duplicate experiment for the same stage", async () => {
    const experiments = new FakeExperimentStore();
    const funnelCounts: FunnelCounts = {
      prospects: 100,
      qualified: 60,
      byStage: { Contacted: 54, Engaged: 2, "Meeting Booked": 1, "Proposal Sent": 1 },
      won: 1,
      wonValue: 5000,
    };

    const first = buildManager({ goals: [buildGoal({ target: 10 })], funnelCounts, experiments });
    await first.manager.runCycle("goal-1", AS_OF);
    expect(experiments.experiments).toHaveLength(1);

    const second = buildManager({ goals: [buildGoal({ target: 10 })], funnelCounts, experiments });
    const result = await second.manager.runCycle("goal-1", AS_OF);

    expect(result.execution.kind).toBe("escalated");
    expect(experiments.experiments).toHaveLength(1); // no duplicate created
    expect(second.gmailSender.sent[0].body).toMatch(/already running/);
  });

  it("runAll cycles through every active goal", async () => {
    const { manager, decisions } = buildManager({
      goals: [buildGoal({ id: "goal-1", target: 1 }), buildGoal({ id: "goal-2", target: 1 })],
      funnelCounts: { prospects: 10, qualified: 10, won: 1, wonValue: 1000 },
    });

    const results = await manager.runAll(AS_OF);

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.goalId).sort()).toEqual(["goal-1", "goal-2"]);
    expect(decisions.records).toHaveLength(2);
  });
});
