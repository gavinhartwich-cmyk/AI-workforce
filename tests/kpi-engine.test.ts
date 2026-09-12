import { describe, expect, it } from "vitest";
import { computeKpiValue } from "../src/goals/kpi-engine.js";
import type { FunnelReader } from "../src/db/hartwich-os/funnel-reader.js";
import type { AgentHealthReader } from "../src/db/agent-health-reader.js";
import type { AnalyticsReader } from "../src/db/analytics-reader.js";
import type { Period } from "../src/goals/types.js";

const PERIOD: Period = { start: new Date("2026-09-01T00:00:00Z"), end: new Date("2026-10-01T00:00:00Z") };

class FakeFunnelReader implements FunnelReader {
  constructor(
    private counts: {
      prospects?: number;
      qualified?: number;
      won?: number;
      lost?: number;
      wonValue?: number;
      auditActions?: Record<string, number>;
    } = {}
  ) {}
  async countCompaniesCreated() {
    return this.counts.prospects ?? 0;
  }
  async countCompaniesByStatus() {
    return this.counts.qualified ?? 0;
  }
  async countDealsCreated() {
    return 0;
  }
  async countDealsByStageName() {
    return 0;
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
  async countAuditAction(action: string) {
    return this.counts.auditActions?.[action] ?? 0;
  }
}

class FakeAgentHealthReader implements AgentHealthReader {
  constructor(private result: { total: number; succeeded: number } = { total: 0, succeeded: 0 }) {}
  async getSuccessRate() {
    return this.result;
  }
}

class FakeAnalyticsReader implements AnalyticsReader {
  constructor(private counts: { positiveConversations?: number; optOuts?: number } = {}) {}
  async countPositiveConversations() {
    return this.counts.positiveConversations ?? 0;
  }
  async countOptOuts() {
    return this.counts.optOuts ?? 0;
  }
}

function deps(overrides: {
  funnel?: FunnelReader;
  agentHealth?: AgentHealthReader;
  analytics?: AnalyticsReader;
} = {}) {
  return {
    funnel: overrides.funnel ?? new FakeFunnelReader(),
    agentHealth: overrides.agentHealth ?? new FakeAgentHealthReader(),
    analytics: overrides.analytics ?? new FakeAnalyticsReader(),
  };
}

describe("computeKpiValue — Phase 8 additions", () => {
  it("computes close_rate as won / (won + lost)", async () => {
    const kpi = await computeKpiValue(
      "close_rate",
      PERIOD,
      deps({ funnel: new FakeFunnelReader({ won: 3, lost: 1 }) })
    );
    expect(kpi.value).toBe(75);
    expect(kpi.confidence).toBe(1);
  });

  it("returns null close_rate with zero confidence when nothing has closed", async () => {
    const kpi = await computeKpiValue("close_rate", PERIOD, deps());
    expect(kpi.value).toBeNull();
    expect(kpi.confidence).toBe(0);
  });

  it("computes agent_error_rate as the inverse of agent_success_rate", async () => {
    const kpi = await computeKpiValue(
      "agent_error_rate",
      PERIOD,
      deps({ agentHealth: new FakeAgentHealthReader({ total: 20, succeeded: 18 }) })
    );
    expect(kpi.value).toBe(10);
  });

  it("returns null agent_error_rate when no agent runs exist yet", async () => {
    const kpi = await computeKpiValue("agent_error_rate", PERIOD, deps());
    expect(kpi.value).toBeNull();
    expect(kpi.confidence).toBe(0);
  });

  it("computes prospects_per_client as prospects / new_clients", async () => {
    const kpi = await computeKpiValue(
      "prospects_per_client",
      PERIOD,
      deps({ funnel: new FakeFunnelReader({ prospects: 40, won: 2 }) })
    );
    expect(kpi.value).toBe(20);
  });

  it("returns null prospects_per_client when no client has been won", async () => {
    const kpi = await computeKpiValue("prospects_per_client", PERIOD, deps({ funnel: new FakeFunnelReader({ prospects: 40 }) }));
    expect(kpi.value).toBeNull();
  });

  it("reads human_escalations from hartwich-os's audit_log task.created count", async () => {
    const kpi = await computeKpiValue(
      "human_escalations",
      PERIOD,
      deps({ funnel: new FakeFunnelReader({ auditActions: { "task.created": 4 } }) })
    );
    expect(kpi.value).toBe(4);
    expect(kpi.confidence).toBe(1);
  });

  it("reads outreach_sent from the email.cold_outreach_sent audit action", async () => {
    const kpi = await computeKpiValue(
      "outreach_sent",
      PERIOD,
      deps({ funnel: new FakeFunnelReader({ auditActions: { "email.cold_outreach_sent": 12 } }) })
    );
    expect(kpi.value).toBe(12);
  });

  it("reads follow_ups_completed from the email.follow_up_sent audit action", async () => {
    const kpi = await computeKpiValue(
      "follow_ups_completed",
      PERIOD,
      deps({ funnel: new FakeFunnelReader({ auditActions: { "email.follow_up_sent": 7 } }) })
    );
    expect(kpi.value).toBe(7);
  });

  it("reads positive_conversations from this repo's own analytics reader, with reduced confidence", async () => {
    const kpi = await computeKpiValue(
      "positive_conversations",
      PERIOD,
      deps({ analytics: new FakeAnalyticsReader({ positiveConversations: 5 }) })
    );
    expect(kpi.value).toBe(5);
    expect(kpi.confidence).toBe(0.8);
  });

  it("reads opt_outs from this repo's own suppressed_contacts", async () => {
    const kpi = await computeKpiValue("opt_outs", PERIOD, deps({ analytics: new FakeAnalyticsReader({ optOuts: 2 }) }));
    expect(kpi.value).toBe(2);
    expect(kpi.confidence).toBe(1);
  });

  it("still honestly returns null for human_hours_per_client — no instrumentation exists", async () => {
    const kpi = await computeKpiValue("human_hours_per_client", PERIOD, deps());
    expect(kpi.value).toBeNull();
    expect(kpi.confidence).toBe(0);
  });
});
