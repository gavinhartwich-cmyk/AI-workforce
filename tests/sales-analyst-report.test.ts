import { describe, expect, it } from "vitest";
import { getSalesAnalystReport } from "../src/goals/sales-analyst-report.js";
import type { FunnelReader } from "../src/db/hartwich-os/funnel-reader.js";
import type { AgentHealthReader } from "../src/db/agent-health-reader.js";
import type { AnalyticsReader } from "../src/db/analytics-reader.js";
import type { Period } from "../src/goals/types.js";

const PERIOD: Period = { start: new Date("2026-09-01T00:00:00Z"), end: new Date("2026-10-01T00:00:00Z") };

class FakeFunnelReader implements FunnelReader {
  async countCompaniesCreated() {
    return 100;
  }
  async countCompaniesByStatus(status: "qualified" | "needs_review" | "disqualified") {
    return status === "qualified" ? 50 : 0;
  }
  async countDealsCreated() {
    return 50;
  }
  async countDealsByStageName(stageName: string) {
    if (stageName === "Contacted") return 40;
    if (stageName === "Engaged") return 10;
    if (stageName === "Meeting Booked") return 5;
    if (stageName === "Proposal Sent") return 3;
    return 0;
  }
  async countDealsWon() {
    return 2;
  }
  async sumWonDealValue() {
    return 10000;
  }
  async countDealsLost() {
    return 1;
  }
  async countAuditAction(action: string) {
    if (action === "task.created") return 3;
    if (action === "email.cold_outreach_sent") return 40;
    if (action === "email.follow_up_sent") return 15;
    return 0;
  }
}

class FakeAgentHealthReader implements AgentHealthReader {
  async getSuccessRate() {
    return { total: 100, succeeded: 95 };
  }
}

class FakeAnalyticsReader implements AnalyticsReader {
  async countPositiveConversations() {
    return 8;
  }
  async countOptOuts() {
    return 1;
  }
}

describe("getSalesAnalystReport", () => {
  it("groups funnel/business/efficiency/quality metrics for the whole period (SPEC.md §33)", async () => {
    const report = await getSalesAnalystReport(PERIOD, {
      funnel: new FakeFunnelReader(),
      agentHealth: new FakeAgentHealthReader(),
      analytics: new FakeAnalyticsReader(),
    });

    // Funnel — reuses Phase 3's bottleneck diagnosis wholesale.
    expect(report.funnel.stages[0].volume).toBe(100);
    expect(report.funnel.primaryBottleneck).not.toBeNull();

    // Business.
    expect(report.business.newClients.value).toBe(2);
    expect(report.business.revenue.value).toBe(10000);
    expect(report.business.closeRate.value).toBeCloseTo((2 / 3) * 100, 1);

    // Efficiency.
    expect(report.efficiency.agentSuccessRate.value).toBe(95);
    expect(report.efficiency.revenuePerProspect.value).toBe(100);
    expect(report.efficiency.prospectsPerClient.value).toBe(50);
    expect(report.efficiency.humanEscalations.value).toBe(3);
    expect(report.efficiency.humanHoursPerClient.value).toBeNull();

    // Quality.
    expect(report.quality.optOuts.value).toBe(1);
    expect(report.quality.agentErrorRate.value).toBe(5);
    expect(report.quality.qualificationAccuracy.value).toBeNull();
    expect(report.quality.qualificationAccuracy.confidence).toBe(0);

    // Data confidence is a real, derived mean — not a fixed constant.
    expect(report.quality.dataConfidence.value).toBeGreaterThan(0);
    expect(report.quality.dataConfidence.value).toBeLessThanOrEqual(1);

    expect(report.observation).toMatch(/2 new client\(s\)/);
    expect(report.observation).toMatch(/3 conversation\(s\) needed a human/);
  });

  it("reports no escalations plainly when none occurred", async () => {
    class NoEscalationsFunnel extends FakeFunnelReader {
      async countAuditAction(action: string) {
        return action === "task.created" ? 0 : super.countAuditAction(action);
      }
    }
    const report = await getSalesAnalystReport(PERIOD, {
      funnel: new NoEscalationsFunnel(),
      agentHealth: new FakeAgentHealthReader(),
      analytics: new FakeAnalyticsReader(),
    });
    expect(report.observation).toMatch(/No conversation needed human escalation/);
  });
});
