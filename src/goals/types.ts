/**
 * Goal/KPI/Forecast/Manager-Decision types (SPEC.md §8-13, §36, §49).
 */

// GoalMetric is a TS union, not a DB enum (src/db/schema.ts's comment on
// salesGoals explains why): adding a metric the KPI engine can compute is
// a code change to src/goals/kpi-engine.ts, never a migration.
export type GoalMetric =
  // Outcome (SPEC.md §8 "Business outcomes")
  | "new_clients"
  | "revenue"
  | "mrr"
  | "close_rate" // Phase 8, SPEC.md §33 "business metrics ... close rate"
  // Pipeline (SPEC.md §8 "Sales outcomes")
  | "qualified_opportunities"
  | "meetings_booked"
  | "positive_conversations"
  // Leading indicators (SPEC.md §8 "Activity goals")
  | "prospects_discovered"
  | "qualified_prospects"
  | "outreach_sent"
  | "follow_ups_completed"
  // Efficiency (SPEC.md §8 "Efficiency"; §33 adds prospects-per-client and human intervention)
  | "agent_success_rate"
  | "revenue_per_prospect"
  | "prospects_per_client"
  | "human_escalations"
  | "human_hours_per_client"
  // Quality (Phase 8, SPEC.md §33 "quality: response quality, qualification
  // accuracy, data confidence, opt-outs, errors")
  | "opt_outs"
  | "agent_error_rate";

export type GoalPriority = "low" | "normal" | "high" | "critical";

export type GoalStatus = "NOT_STARTED" | "ON_TRACK" | "AT_RISK" | "BEHIND" | "CRITICAL" | "ACHIEVED" | "FAILED";

export type GoalConstraints = {
  maxDailyOutreach?: number;
  maxBudget?: number;
  maxHumanHours?: number;
  allowedChannels?: string[];
};

export type SalesGoal = {
  id: string;
  metric: GoalMetric;
  target: number;
  periodStart: Date;
  periodEnd: Date;
  priority: GoalPriority;
  constraints: GoalConstraints | null;
  status: GoalStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type Period = { start: Date; end: Date };

/**
 * What the KPI Engine returns for one metric (SPEC.md §9-10): a null
 * `value` with `confidence: 0` means "no data source exists for this
 * metric yet" — never a fabricated zero pretending to be a measurement.
 */
export type KpiValue = {
  value: number | null;
  confidence: number; // 0-1
  dataSource: string;
  note?: string;
};

export type PaceResult = {
  daysElapsed: number;
  daysTotal: number;
  daysRemaining: number;
  expectedByNow: number;
  currentPace: number; // units/day, based on elapsed time
  requiredFuturePace: number; // units/day needed over the remaining days to hit target
  varianceVsExpected: number; // current - expectedByNow
};

export type ForecastResult = {
  projectedFinal: number;
  /** 0-100, a documented heuristic (src/goals/pace-forecast.ts) — not a calibrated model yet. */
  probability: number;
  status: GoalStatus;
};

export type FunnelStageVolume = {
  stage: string;
  /** null means "no data source for this stage yet," not zero. */
  volume: number | null;
};

export type StageConversion = {
  fromStage: string;
  toStage: string;
  volumeFrom: number | null;
  volumeTo: number | null;
  actualConversionRate: number | null;
  targetConversionRate: number | null;
  variance: number | null;
  /** Extra units at the final stage if this step's rate matched target, holding every other actual rate fixed. Null if not computable (e.g. a data gap). */
  impactOnFinalStage: number | null;
};

export type BottleneckDiagnosis = {
  stages: FunnelStageVolume[];
  conversions: StageConversion[];
  primaryBottleneck: StageConversion | null;
  observation: string;
  diagnosis: string;
};

export type ManagerDecisionOption = {
  action: string;
  expectedImpact: number;
  confidence: number;
  risk: number;
};

/** SPEC.md §36's ManagerDecision interface. */
export type ManagerDecision = {
  id?: string;
  goalId: string;
  observation: string;
  diagnosis: string;
  options: ManagerDecisionOption[];
  selectedAction: string;
  reason: string;
  expectedOutcome: string;
  actualOutcome?: string | null;
  createdAt?: Date;
};

export type GoalStatusReport = {
  goal: SalesGoal;
  kpi: KpiValue;
  pace: PaceResult;
  forecast: ForecastResult;
  bottleneck: BottleneckDiagnosis;
};
