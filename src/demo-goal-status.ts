/**
 * Phase 3 demo — answers "are we on track to hit our sales goal?" end to
 * end with zero configuration (no AGENT_DATABASE_URL/HARTWICH_DATABASE_URL
 * needed): a fixed goal, fixture funnel numbers, and printing stand-ins for
 * the KPI-snapshot/forecast/manager-decision stores instead of a real
 * database. Point those three stores' real Postgres implementations
 * (src/goals/kpi-snapshot-store.ts, forecast-store.ts,
 * manager-decision-store.ts) at AGENT_DATABASE_URL for the real version.
 *
 * Run with: npm run demo:goal-status
 */
import type { GoalStore } from "./goals/goal-store.js";
import type { KpiSnapshotStore } from "./goals/kpi-snapshot-store.js";
import type { ForecastStore } from "./goals/forecast-store.js";
import type { ManagerDecisionStore } from "./goals/manager-decision-store.js";
import type { FunnelReader } from "./db/hartwich-os/funnel-reader.js";
import type { AgentHealthReader } from "./db/agent-health-reader.js";
import type { AnalyticsReader } from "./db/analytics-reader.js";
import type { ManagerDecision, SalesGoal } from "./goals/types.js";
import { getGoalStatusReport } from "./goals/goal-status-report.js";

const PERIOD_START = new Date("2026-09-01T00:00:00Z");
const PERIOD_END = new Date("2026-10-01T00:00:00Z"); // 30-day September goal
const AS_OF = new Date("2026-09-16T00:00:00Z"); // pretend "today" is day 15 of 30

const GOAL: SalesGoal = {
  id: "demo-goal",
  metric: "new_clients",
  target: 10,
  periodStart: PERIOD_START,
  periodEnd: PERIOD_END,
  priority: "critical",
  constraints: null,
  status: "NOT_STARTED",
  createdAt: PERIOD_START,
  updatedAt: PERIOD_START,
};

class FixedGoalStore implements GoalStore {
  async create(): Promise<SalesGoal> {
    throw new Error("not used in this demo");
  }
  async get(id: string) {
    return id === GOAL.id ? GOAL : null;
  }
  async listActive() {
    return [GOAL];
  }
  async updateStatus(_id: string, status: SalesGoal["status"]) {
    console.log(`  (would update goal status → ${status})`);
  }
}

// Fixture: discovery has run (matches src/demo-discover.ts's scale) and
// qualification is working, but nothing has been contacted yet — no
// Outreach Execution agent exists until Phase 5.
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
    return 0;
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

class PrintingKpiSnapshotStore implements KpiSnapshotStore {
  async record(_goalId: string, metric: string, kpi: { value: number | null; confidence: number }) {
    console.log(`  KPI snapshot: ${metric} = ${kpi.value} (confidence ${kpi.confidence})`);
  }
}

class PrintingForecastStore implements ForecastStore {
  async record() {
    console.log(`  Forecast recorded.`);
  }
}

class PrintingManagerDecisionStore implements ManagerDecisionStore {
  async record(decision: ManagerDecision) {
    console.log(`  Manager decision recorded: "${decision.selectedAction.slice(0, 60)}..."`);
    return "demo-decision";
  }
  async list() {
    return [];
  }
}

async function main() {
  const report = await getGoalStatusReport(
    GOAL.id,
    {
      goals: new FixedGoalStore(),
      funnel: new FixtureFunnelReader(),
      agentHealth: new FixtureAgentHealthReader(),
      analytics: new FixtureAnalyticsReader(),
      kpiSnapshots: new PrintingKpiSnapshotStore(),
      forecasts: new PrintingForecastStore(),
      decisions: new PrintingManagerDecisionStore(),
    },
    AS_OF
  );

  console.log(`\nHARTWICH SALES REPORT`);
  console.log(`GOAL: ${report.goal.target} ${report.goal.metric} by ${report.goal.periodEnd.toDateString()}`);
  console.log(`CURRENT: ${report.kpi.value} (confidence ${report.kpi.confidence}, source: ${report.kpi.dataSource})`);
  console.log(`PACE: expected ${report.pace.expectedByNow} by now (day ${report.pace.daysElapsed}/${report.pace.daysTotal}), variance ${report.pace.varianceVsExpected}`);
  console.log(`FORECAST: ${report.forecast.projectedFinal} (${report.forecast.probability}% probability) — STATUS: ${report.forecast.status}`);
  console.log(`\nBOTTLENECK`);
  console.log(`  ${report.bottleneck.observation}`);
  console.log(`  ${report.bottleneck.diagnosis}`);
  console.log(`\nDecision record: ${report.decisionId}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
