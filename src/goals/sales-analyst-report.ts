import type { FunnelReader } from "../db/hartwich-os/funnel-reader.js";
import type { AgentHealthReader } from "../db/agent-health-reader.js";
import type { AnalyticsReader } from "../db/analytics-reader.js";
import { computeKpiValue } from "./kpi-engine.js";
import { getFunnelStageVolumes, DEFAULT_TARGET_CONVERSION_RATES } from "./funnel-stages.js";
import { detectBottleneck } from "./bottleneck-engine.js";
import type { BottleneckDiagnosis, KpiValue, Period } from "./types.js";

export type SalesAnalystReport = {
  period: Period;
  /** SPEC.md §33 "the funnel" — reuses Phase 3's own diagnosis, not a second implementation. */
  funnel: BottleneckDiagnosis;
  /** SPEC.md §33 "business metrics (revenue, clients, MRR, close rate)". */
  business: { newClients: KpiValue; revenue: KpiValue; mrr: KpiValue; closeRate: KpiValue };
  /** SPEC.md §33 "efficiency (agent utilization, human intervention, human minutes, prospects per client, revenue per prospect)". */
  efficiency: {
    agentSuccessRate: KpiValue;
    revenuePerProspect: KpiValue;
    prospectsPerClient: KpiValue;
    humanEscalations: KpiValue;
    humanHoursPerClient: KpiValue;
  };
  /** SPEC.md §33 "quality (response quality, qualification accuracy, data confidence, opt-outs, errors)". */
  quality: { optOuts: KpiValue; agentErrorRate: KpiValue; qualificationAccuracy: KpiValue; dataConfidence: KpiValue };
  observation: string;
};

/**
 * Sales Analyst (SPEC.md §55 Phase 8, §33). Deterministic aggregation only
 * — same "no LLM involved in computing a number" rule as the KPI Engine
 * (src/goals/kpi-engine.ts) it's built entirely out of. This isn't a new
 * measurement system: every field here is a KPI Engine metric or Phase 3's
 * bottleneck diagnosis, regrouped into SPEC.md §33's four categories for
 * one whole-business snapshot instead of one goal at a time
 * (src/goals/goal-status-report.ts stays the "is THIS goal on track" tool;
 * this is "how is the business doing, period, across everything we track").
 *
 * Two metrics SPEC.md §33 names are deliberately absent rather than faked:
 * - "response quality" has no code-checkable definition (it's a judgment
 *   call about tone/relevance) — a later phase could add an LLM-as-judge
 *   agent for it, but that's a real new agent, not a KPI Engine case.
 * - "qualification accuracy" needs a ground-truth label (did a qualified
 *   lead actually convert, did a disqualified one never would have)
 *   that nothing in this system captures yet — hartwich-os has no
 *   after-the-fact outcome-vs-qualification-score comparison to query.
 * Both stay honest gaps, not invented numbers.
 *
 * "Data confidence" instead gets a real, computable definition: the mean
 * confidence across every KpiValue in this very report — how much of this
 * report itself should be trusted, not a property of hartwich-os's records.
 */
export async function getSalesAnalystReport(
  period: Period,
  deps: {
    funnel: FunnelReader;
    agentHealth: AgentHealthReader;
    analytics: AnalyticsReader;
    targetConversionRates?: Record<string, number>;
  }
): Promise<SalesAnalystReport> {
  const kpiDeps = { funnel: deps.funnel, agentHealth: deps.agentHealth, analytics: deps.analytics };

  const [
    newClients,
    revenue,
    mrr,
    closeRate,
    agentSuccessRate,
    revenuePerProspect,
    prospectsPerClient,
    humanEscalations,
    optOuts,
    agentErrorRate,
    stages,
  ] = await Promise.all([
    computeKpiValue("new_clients", period, kpiDeps),
    computeKpiValue("revenue", period, kpiDeps),
    computeKpiValue("mrr", period, kpiDeps),
    computeKpiValue("close_rate", period, kpiDeps),
    computeKpiValue("agent_success_rate", period, kpiDeps),
    computeKpiValue("revenue_per_prospect", period, kpiDeps),
    computeKpiValue("prospects_per_client", period, kpiDeps),
    computeKpiValue("human_escalations", period, kpiDeps),
    computeKpiValue("opt_outs", period, kpiDeps),
    computeKpiValue("agent_error_rate", period, kpiDeps),
    getFunnelStageVolumes(period, deps.funnel),
  ]);

  const humanHoursPerClient = await computeKpiValue("human_hours_per_client", period, kpiDeps);
  const funnel = detectBottleneck(stages, deps.targetConversionRates ?? DEFAULT_TARGET_CONVERSION_RATES);

  const qualificationAccuracy: KpiValue = {
    value: null,
    confidence: 0,
    dataSource: "none",
    note: "No ground-truth outcome-vs-qualification-score comparison exists yet to check accuracy against.",
  };

  const allValues = [
    newClients,
    revenue,
    mrr,
    closeRate,
    agentSuccessRate,
    revenuePerProspect,
    prospectsPerClient,
    humanEscalations,
    humanHoursPerClient,
    optOuts,
    agentErrorRate,
    qualificationAccuracy,
  ];
  const dataConfidence: KpiValue = {
    value: Math.round((allValues.reduce((sum, v) => sum + v.confidence, 0) / allValues.length) * 100) / 100,
    confidence: 1,
    dataSource: "derived: mean confidence across this report's own KPI values",
    note: "How much of THIS report should be trusted, not a property of hartwich-os's data quality.",
  };

  const observation = [
    funnel.observation,
    `${newClients.value ?? 0} new client(s), $${revenue.value ?? 0} revenue, ${
      closeRate.value != null ? `${closeRate.value}% close rate` : "no deals closed yet"
    } this period.`,
    humanEscalations.value != null && humanEscalations.value > 0
      ? `${humanEscalations.value} conversation(s) needed a human this period.`
      : "No conversation needed human escalation this period.",
  ].join(" ");

  return {
    period,
    funnel,
    business: { newClients, revenue, mrr, closeRate },
    efficiency: { agentSuccessRate, revenuePerProspect, prospectsPerClient, humanEscalations, humanHoursPerClient },
    quality: { optOuts, agentErrorRate, qualificationAccuracy, dataConfidence },
    observation,
  };
}
