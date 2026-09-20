import type { FunnelReader } from "../db/hartwich-os/funnel-reader.js";
import type { AgentHealthReader } from "../db/agent-health-reader.js";
import type { AnalyticsReader } from "../db/analytics-reader.js";
import type { GoalMetric, KpiValue, Period } from "./types.js";

/**
 * KPI Engine (SPEC.md §10): deterministic, code-only aggregation — no LLM
 * involved in computing a number. Every branch either has a real data
 * source (hartwich-os's companies/deals/audit_log, or this repo's own
 * agent_runs/suppressed_contacts) or honestly returns `value: null,
 * confidence: 0` for a metric nothing tracks yet.
 *
 * `positive_conversations`, `outreach_sent`, and `follow_ups_completed`
 * were exactly that kind of honest null through Phase 3-6 — there was no
 * conversation classifier or outbound-send record to read yet. Phase 8
 * wires them up now that Phase 6/7 actually produce that data (Conversation
 * Intelligence's classification, and Phase 7's audit_log rows for every
 * send). `human_hours_per_client` stays null: nothing in this system times
 * a human's minutes, and estimating that from agent activity would be a
 * fabricated number wearing a KPI's clothes, not a measurement.
 */
export async function computeKpiValue(
  metric: GoalMetric,
  period: Period,
  deps: { funnel: FunnelReader; agentHealth: AgentHealthReader; analytics: AnalyticsReader }
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

    case "close_rate": {
      const [won, lost] = await Promise.all([deps.funnel.countDealsWon(period), deps.funnel.countDealsLost(period)]);
      const closed = won + lost;
      return closed > 0
        ? {
            value: Math.round((won / closed) * 1000) / 10,
            confidence: 1,
            dataSource: "derived: deals won / (deals won + deals lost)",
          }
        : { value: null, confidence: 0, dataSource: "derived", note: "No deal has closed (won or lost) in this period yet." };
    }

    case "agent_success_rate": {
      const { total, succeeded } = await deps.agentHealth.getSuccessRate(period);
      return {
        value: total > 0 ? Math.round((succeeded / total) * 1000) / 10 : null,
        confidence: total > 0 ? 1 : 0,
        dataSource: "this repo's agent_runs",
        note: total === 0 ? "No agent runs recorded in this period yet." : undefined,
      };
    }

    case "agent_error_rate": {
      const { total, succeeded } = await deps.agentHealth.getSuccessRate(period);
      return {
        value: total > 0 ? Math.round(((total - succeeded) / total) * 1000) / 10 : null,
        confidence: total > 0 ? 1 : 0,
        dataSource: "derived: 1 - agent_success_rate, from this repo's agent_runs",
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

    case "prospects_per_client": {
      const [prospects, newClients] = await Promise.all([
        deps.funnel.countCompaniesCreated(period),
        deps.funnel.countDealsWon(period),
      ]);
      return newClients > 0
        ? {
            value: Math.round((prospects / newClients) * 100) / 100,
            confidence: 1,
            dataSource: "derived: prospects_discovered / new_clients",
          }
        : { value: null, confidence: 0, dataSource: "derived", note: "No client won in this period yet." };
    }

    case "human_escalations":
      return {
        value: await deps.funnel.countAuditAction("task.created", period),
        confidence: 1,
        dataSource: "hartwich-os audit_log (task.created)",
        note: "A task is created whenever Conversation Intelligence escalates a reply to Gavin (Phase 7) — the concrete 'human intervention' signal, not an estimate.",
      };

    case "outreach_sent":
      return {
        value: await deps.funnel.countAuditAction("email.cold_outreach_sent", period),
        confidence: 1,
        dataSource: "hartwich-os audit_log (email.cold_outreach_sent)",
      };

    case "follow_ups_completed":
      return {
        value: await deps.funnel.countAuditAction("email.follow_up_sent", period),
        confidence: 1,
        dataSource: "hartwich-os audit_log (email.follow_up_sent)",
      };

    case "positive_conversations":
      return {
        value: await deps.analytics.countPositiveConversations(period),
        confidence: 0.8,
        dataSource: "this repo's agent_runs (conversation_intelligence_agent output.classification = INTERESTED)",
        note: "A model classification, not a ground-truth label — confidence reflects that a human hasn't verified each one.",
      };

    case "opt_outs":
      return {
        value: await deps.analytics.countOptOuts(period),
        confidence: 1,
        dataSource: "this repo's suppressed_contacts",
      };

    case "human_hours_per_client":
      return {
        value: null,
        confidence: 0,
        dataSource: "none",
        note: "No instrumentation measures human time spent — this stays an honest null rather than an estimate derived from agent activity.",
      };
  }
}
