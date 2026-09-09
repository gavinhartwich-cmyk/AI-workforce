import type { GoalStore } from "./goal-store.js";
import type { KpiSnapshotStore } from "./kpi-snapshot-store.js";
import type { ForecastStore } from "./forecast-store.js";
import type { ManagerDecisionStore } from "./manager-decision-store.js";
import type { FunnelReader } from "../db/hartwich-os/funnel-reader.js";
import type { AgentHealthReader } from "../db/agent-health-reader.js";
import type { AnalyticsReader } from "../db/analytics-reader.js";
import { computeKpiValue } from "./kpi-engine.js";
import { computePace, computeForecast, type ForecastThresholds } from "./pace-forecast.js";
import { getFunnelStageVolumes, DEFAULT_TARGET_CONVERSION_RATES } from "./funnel-stages.js";
import { detectBottleneck } from "./bottleneck-engine.js";
import type { GoalStatusReport } from "./types.js";

/**
 * Answers SPEC.md §55 Phase 2/3's required question: "are we on track to
 * hit our sales goal?" Pure orchestration — every actual computation
 * (KPI value, pace, forecast, bottleneck) is a deterministic function or
 * query elsewhere in src/goals/; this just calls them in order and
 * persists what each step produced (SPEC.md §36: institutional memory).
 *
 * The manager_decisions row this writes is diagnosis-only — SPEC.md §36's
 * `ManagerDecision.options` is `[]` and `selectedAction` says outright that
 * there's no autonomous decision-maker yet. Phase 9's Sales Manager is
 * what actually chooses and executes an intervention; Phase 3 only has to
 * prove the diagnosis is right.
 */
export async function getGoalStatusReport(
  goalId: string,
  deps: {
    goals: GoalStore;
    funnel: FunnelReader;
    agentHealth: AgentHealthReader;
    analytics: AnalyticsReader;
    kpiSnapshots: KpiSnapshotStore;
    forecasts: ForecastStore;
    decisions: ManagerDecisionStore;
    targetConversionRates?: Record<string, number>;
    forecastThresholds?: ForecastThresholds;
  },
  asOf: Date = new Date()
): Promise<GoalStatusReport> {
  const goal = await deps.goals.get(goalId);
  if (!goal) throw new Error(`No sales goal found with id "${goalId}".`);

  const period = { start: goal.periodStart, end: goal.periodEnd };

  const kpi = await computeKpiValue(goal.metric, period, {
    funnel: deps.funnel,
    agentHealth: deps.agentHealth,
    analytics: deps.analytics,
  });
  await deps.kpiSnapshots.record(goal.id, goal.metric, kpi, asOf);

  const currentValue = kpi.value ?? 0;
  const pace = computePace(period, goal.target, currentValue, asOf);
  const forecast = computeForecast(pace, goal.target, currentValue, deps.forecastThresholds);
  await deps.forecasts.record(goal.id, pace, forecast, currentValue, asOf);
  await deps.goals.updateStatus(goal.id, forecast.status);

  const stages = await getFunnelStageVolumes(period, deps.funnel);
  const bottleneck = detectBottleneck(stages, deps.targetConversionRates ?? DEFAULT_TARGET_CONVERSION_RATES);

  const decisionId = await deps.decisions.record({
    goalId: goal.id,
    observation: bottleneck.observation,
    diagnosis: bottleneck.diagnosis,
    options: [],
    selectedAction: "none — Phase 3 has no autonomous decision-maker yet; this is a diagnostic record for a human, or the future Sales Manager (SPEC.md §55 Phase 9), to act on.",
    reason: `Goal "${goal.metric}" is ${forecast.status} (current ${currentValue}, expected-by-now ${pace.expectedByNow}, projected final ${forecast.projectedFinal} vs. target ${goal.target}).`,
    expectedOutcome: "n/a — no action was taken.",
  });

  return { goal, kpi, pace, forecast, bottleneck, decisionId };
}
