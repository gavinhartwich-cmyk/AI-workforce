/**
 * Phase 8 demo — the Sales Analyst (SPEC.md §55 Phase 8, §33): one
 * whole-business snapshot for a period, grouped into funnel/business/
 * efficiency/quality, against fixtures (no AGENT_DATABASE_URL/
 * HARTWICH_DATABASE_URL needed). Same fixture story as demo-goal-status.ts
 * (discovery and qualification are working) carried forward through where
 * Phases 4-7 now leave the funnel: real outreach sent, some replies,
 * a couple of closed deals, and one escalation to Gavin.
 *
 * Run with: npm run demo:sales-analyst
 */
import type { FunnelReader } from "./db/hartwich-os/funnel-reader.js";
import type { AgentHealthReader } from "./db/agent-health-reader.js";
import type { AnalyticsReader } from "./db/analytics-reader.js";
import { getSalesAnalystReport } from "./goals/sales-analyst-report.js";

const PERIOD = { start: new Date("2026-09-01T00:00:00Z"), end: new Date("2026-10-01T00:00:00Z") }; // September

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
  async countDealsByStageName(stageName: string) {
    if (stageName === "Contacted") return 15;
    if (stageName === "Engaged") return 6;
    if (stageName === "Meeting Booked") return 3;
    if (stageName === "Proposal Sent") return 2;
    return 0;
  }
  async countDealsWon() {
    return 1;
  }
  async sumWonDealValue() {
    return 4500;
  }
  async countDealsLost() {
    return 2;
  }
  async countAuditAction(action: string) {
    if (action === "email.cold_outreach_sent") return 15;
    if (action === "email.follow_up_sent") return 9;
    if (action === "task.created") return 1;
    return 0;
  }
}

class FixtureAgentHealthReader implements AgentHealthReader {
  async getSuccessRate() {
    return { total: 210, succeeded: 204 };
  }
}

class FixtureAnalyticsReader implements AnalyticsReader {
  async countPositiveConversations() {
    return 4;
  }
  async countOptOuts() {
    return 1;
  }
}

function line(label: string, kpi: { value: number | null; confidence: number; note?: string }): string {
  const value = kpi.value != null ? kpi.value : "n/a";
  const suffix = kpi.note ? ` (${kpi.note})` : "";
  return `  ${label}: ${value} (confidence ${kpi.confidence})${suffix}`;
}

async function main() {
  const report = await getSalesAnalystReport(PERIOD, {
    funnel: new FixtureFunnelReader(),
    agentHealth: new FixtureAgentHealthReader(),
    analytics: new FixtureAnalyticsReader(),
  });

  console.log(`SALES ANALYST — ${report.period.start.toDateString()} to ${report.period.end.toDateString()}\n`);

  console.log("FUNNEL");
  for (const stage of report.funnel.stages) console.log(`  ${stage.stage}: ${stage.volume ?? "n/a"}`);
  console.log(`  ${report.funnel.observation}`);
  console.log(`  ${report.funnel.diagnosis}\n`);

  console.log("BUSINESS");
  console.log(line("new_clients", report.business.newClients));
  console.log(line("revenue", report.business.revenue));
  console.log(line("mrr", report.business.mrr));
  console.log(line("close_rate", report.business.closeRate));

  console.log("\nEFFICIENCY");
  console.log(line("agent_success_rate", report.efficiency.agentSuccessRate));
  console.log(line("revenue_per_prospect", report.efficiency.revenuePerProspect));
  console.log(line("prospects_per_client", report.efficiency.prospectsPerClient));
  console.log(line("human_escalations", report.efficiency.humanEscalations));
  console.log(line("human_hours_per_client", report.efficiency.humanHoursPerClient));

  console.log("\nQUALITY");
  console.log(line("opt_outs", report.quality.optOuts));
  console.log(line("agent_error_rate", report.quality.agentErrorRate));
  console.log(line("qualification_accuracy", report.quality.qualificationAccuracy));
  console.log(line("data_confidence", report.quality.dataConfidence));

  console.log(`\nOBSERVATION\n  ${report.observation}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
