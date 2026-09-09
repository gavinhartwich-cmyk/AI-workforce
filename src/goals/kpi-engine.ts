import type { FunnelReader } from "../db/hartwich-os/funnel-reader.js";
import type { AgentHealthReader } from "../db/agent-health-reader.js";
import type { GoalMetric, KpiValue, Period } from "./types.js";

/**
 * KPI Engine (SPEC.md §10): deterministic, code-only aggregation — no LLM
 * involved in computing a number. Every branch either has a real data
 * source (hartwich-os's companies/deals, or this repo's own agent_runs) or
 * honestly returns `value: null, confidence: 0` for a metric nothing
 * tracks yet (positive_conversations, outreach_sent, follow_ups_completed,
 * human_hours_per_client — these land with Phase 4-6's outreach/
 * conversation agents, not before).
 */
export async function computeKpiValue(
  metric: GoalMetric,
  period: Period,
  deps: { funnel: FunnelReader; agentHealth: AgentHealthReader }
): Promise<KpiValue> {
  switch (metric) {
    case "prospects_discovered":
      return {
        value: await deps.funnel.countCompaniesCreated(period),
        confidence: 1,
        dataSource: "hartwich-os companies.created_at",
      };

    case "qualified_prospects":
      return {
        value: await deps.funnel.countCompaniesByStatus("qualified", period),
        confidence: 1,
        dataSource: "hartwich-os companies.status",
        note: "Reflects each company's CURRENT status, not its status at creation time — hartwich-os has no status-history table.",
      };

    case "qualified_opportunities":
      return {
        value: await deps.funnel.countDealsCreated(period),
        confidence: 1,
        dataSource: "hartwich-os deals.created_at",
      };

    case "meetings_booked":
      return {
        value: await deps.funnel.countDealsByStageName("Meeting Booked", period),
        confidence: 0.8,
        dataSource: "hartwich-os deals × pipeline_stages.name",
        note: 'Assumes a pipeline stage literally named "Meeting Booked" — matches hartwich-os\'s seeded defaults, but a renamed stage would silently read as zero.',
      };

    case "new_clients":
      return {
        value: await deps.funnel.countDealsWon(period),
        confidence: 1,
        dataSource: "hartwich-os deals × pipeline_stages.is_won",
      };

    case "revenue":
    case "mrr":
      return {
        value: await deps.funnel.sumWonDealValue(period),
        confidence: 0.5,
        dataSource: "hartwich-os deals.value_estimate (won deals)",
        note: "valueEstimate is optional on hartwich-os deals — any won deal without a value contributes $0, so this likely undercounts until deal values are populated.",
      };

    case "agent_success_rate": {
      const { total, succeeded } = await deps.agentHealth.getSuccessRate(period);
      return {
        value: total > 0 ? Math.round((succeeded / total) * 1000) / 10 : null,
        confidence: total > 0 ? 1 : 0,
        dataSource: "this repo's agent_runs",
        note: total === 0 ? "No agent runs recorded in this period yet." : undefined,
      };
    }

    case "revenue_per_prospect": {
      const [revenue, prospects] = await Promise.all([
        deps.funnel.sumWonDealValue(period),
        deps.funnel.countCompaniesCreated(period),
      ]);
      return prospects > 0
        ? {
            value: Math.round((revenue / prospects) * 100) / 100,
            confidence: 0.5,
            dataSource: "derived: revenue / prospects_discovered",
            note: "Inherits revenue's undercount caveat (valueEstimate often unset).",
          }
        : { value: null, confidence: 0, dataSource: "derived", note: "No prospects discovered in this period yet." };
    }

    case "positive_conversations":
    case "outreach_sent":
    case "follow_ups_completed":
    case "human_hours_per_client":
      return {
        value: null,
        confidence: 0,
        dataSource: "none",
        note: "No data source wired up yet — lands with a later phase (outreach/conversation tracking, or human-time instrumentation).",
      };
  }
}
