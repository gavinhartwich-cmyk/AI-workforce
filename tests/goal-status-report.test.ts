import { describe, expect, it } from "vitest";
import { getGoalStatusReport } from "../src/goals/goal-status-report.js";
import type { GoalStore } from "../src/goals/goal-store.js";
import type { KpiSnapshotStore } from "../src/goals/kpi-snapshot-store.js";
import type { ForecastStore } from "../src/goals/forecast-store.js";
import type { ManagerDecisionStore } from "../src/goals/manager-decision-store.js";
import type { FunnelReader } from "../src/db/hartwich-os/funnel-reader.js";
import type { AgentHealthReader } from "../src/db/agent-health-reader.js";
import type { SalesGoal, GoalStatus, ManagerDecision } from "../src/goals/types.js";

const PERIOD_START = new Date("2026-09-01T00:00:00Z");
const PERIOD_END = new Date("2026-10-01T00:00:00Z"); // 30 days
const AS_OF = new Date("2026-09-16T00:00:00Z"); // day 15 of 30

class FakeGoalStore implements GoalStore {
  goal: SalesGoal;
  statusUpdates: GoalStatus[] = [];
  constructor(goal: SalesGoal) {
    this.goal = goal;
  }
  async create(): Promise<SalesGoal> {
    throw new Error("not used in this test");
  }
  async get(id: string): Promise<SalesGoal | null> {
    return id === this.goal.id ? this.goal : null;
  }
  async listActive(): Promise<SalesGoal[]> {
    return [this.goal];
  }
  async updateStatus(_id: string, status: GoalStatus): Promise<void> {
    this.statusUpdates.push(status);
  }
}

class FakeFunnelReader implements FunnelReader {
  constructor(private counts: { prospects: number; qualified: number; won: number; wonValue: number }) {}
  async countCompaniesCreated() {
    return this.counts.prospects;
  }
  async countCompaniesByStatus() {
    return this.counts.qualified;
  }
  async countDealsCreated() {
    return this.counts.qualified;
  }
  async countDealsByStageName() {
    return 0; // nothing contacted/engaged/etc. yet — no outreach agent exists
  }
  async countDealsWon() {
    return this.counts.won;
  }
  async sumWonDealValue() {
    return this.counts.wonValue;
  }
}

class FakeAgentHealthReader implements AgentHealthReader {
  async getSuccessRate() {
    return { total: 10, succeeded: 9 };
  }
}

class RecordingKpiSnapshotStore implements KpiSnapshotStore {
  records: unknown[] = [];
  async record(goalId: string, metric: string, kpi: unknown, asOf: Date) {
    this.records.push({ goalId, metric, kpi, asOf });
  }
}

class RecordingForecastStore implements ForecastStore {
  records: unknown[] = [];
  async record(goalId: string, pace: unknown, forecast: unknown, currentValue: number, asOf: Date) {
    this.records.push({ goalId, pace, forecast, currentValue, asOf });
  }
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

describe("getGoalStatusReport", () => {
  it("answers 'are we on track' end to end and persists every step", async () => {
    const goal = buildGoal();
    const goals = new FakeGoalStore(goal);
    const kpiSnapshots = new RecordingKpiSnapshotStore();
    const forecasts = new RecordingForecastStore();
    const decisions = new RecordingManagerDecisionStore();

    const report = await getGoalStatusReport(
      goal.id,
      {
        goals,
        // Nothing has closed yet — realistic for right now, since no
        // outreach agent exists to move a deal past "New Lead."
        funnel: new FakeFunnelReader({ prospects: 100, qualified: 50, won: 0, wonValue: 0 }),
        agentHealth: new FakeAgentHealthReader(),
        kpiSnapshots,
        forecasts,
        decisions,
      },
      AS_OF
    );

    expect(report.kpi.value).toBe(0); // new_clients -> countDealsWon
    expect(report.pace.expectedByNow).toBe(5); // target 10, 50% through the period
    expect(report.pace.varianceVsExpected).toBe(-5);
    expect(report.forecast.status).toBe("CRITICAL");
    expect(report.bottleneck.primaryBottleneck?.fromStage).toBe("qualified_prospects");
    expect(report.decisionId).toBe("decision-1");

    expect(kpiSnapshots.records).toHaveLength(1);
    expect(forecasts.records).toHaveLength(1);
    expect(decisions.records).toHaveLength(1);
    expect(decisions.records[0].selectedAction).toMatch(/no autonomous decision-maker yet/);
    expect(goals.statusUpdates).toEqual([report.forecast.status]);
  });

  it("reports ACHIEVED once current value meets or exceeds target", async () => {
    const goal = buildGoal({ target: 2 });
    const goals = new FakeGoalStore(goal);

    const report = await getGoalStatusReport(goal.id, {
      goals,
      funnel: new FakeFunnelReader({ prospects: 100, qualified: 50, won: 2, wonValue: 5000 }),
      agentHealth: new FakeAgentHealthReader(),
      kpiSnapshots: new RecordingKpiSnapshotStore(),
      forecasts: new RecordingForecastStore(),
      decisions: new RecordingManagerDecisionStore(),
    });

    expect(report.forecast.status).toBe("ACHIEVED");
  });

  it("throws a clear error for an unknown goal id", async () => {
    const goals = new FakeGoalStore(buildGoal());
    await expect(
      getGoalStatusReport("does-not-exist", {
        goals,
        funnel: new FakeFunnelReader({ prospects: 0, qualified: 0, won: 0, wonValue: 0 }),
        agentHealth: new FakeAgentHealthReader(),
        kpiSnapshots: new RecordingKpiSnapshotStore(),
        forecasts: new RecordingForecastStore(),
        decisions: new RecordingManagerDecisionStore(),
      })
    ).rejects.toThrow(/No sales goal found/);
  });
});
