import type { ForecastResult, GoalStatus, PaceResult, Period } from "./types.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Pace Engine (SPEC.md §12): how much time has passed, what "on pace"
 * would look like right now, and what rate the remaining time actually
 * requires. Pure function of the period/target/current value — no
 * database, no model call, fully unit-testable.
 */
export function computePace(period: Period, target: number, current: number, asOf: Date = new Date()): PaceResult {
  const daysTotal = Math.max(1, (period.end.getTime() - period.start.getTime()) / MS_PER_DAY);
  const elapsedRaw = (asOf.getTime() - period.start.getTime()) / MS_PER_DAY;
  const daysElapsed = Math.min(daysTotal, Math.max(0, elapsedRaw));
  const daysRemaining = Math.max(0, daysTotal - daysElapsed);

  const expectedByNow = target * (daysElapsed / daysTotal);
  const currentPace = daysElapsed > 0 ? current / daysElapsed : 0;
  const requiredFuturePace = daysRemaining > 0 ? Math.max(0, target - current) / daysRemaining : 0;

  return {
    daysElapsed: Math.round(daysElapsed * 10) / 10,
    daysTotal: Math.round(daysTotal * 10) / 10,
    daysRemaining: Math.round(daysRemaining * 10) / 10,
    expectedByNow: Math.round(expectedByNow * 100) / 100,
    currentPace: Math.round(currentPace * 10000) / 10000,
    requiredFuturePace: Math.round(requiredFuturePace * 10000) / 10000,
    varianceVsExpected: Math.round((current - expectedByNow) * 100) / 100,
  };
}

export type ForecastThresholds = {
  /** ratio = current/expectedByNow; at or above this → ON_TRACK. */
  onTrack: number;
  /** below `onTrack` but at or above this → AT_RISK. Below this but above `critical` → BEHIND. */
  atRisk: number;
  /** below this ratio → CRITICAL. */
  critical: number;
};

export const DEFAULT_FORECAST_THRESHOLDS: ForecastThresholds = {
  onTrack: 1.0,
  atRisk: 0.8,
  critical: 0.5,
};

/**
 * Forecast Engine (SPEC.md §11): projects the final outcome by holding the
 * pace measured so far constant over the remaining time, and derives a
 * status from how today's actual compares to today's expected pace.
 *
 * The `probability` heuristic (SPEC.md §11's illustrative example: a 6.8
 * projection against a target of 10 reads as "34%") is `2*ratio - 1`
 * clamped to [0, 100] — projecting to exactly the target is scored ~100%,
 * projecting to half the target or less is scored 0%. This is a
 * deliberately simple, documented placeholder, not a calibrated
 * statistical model — SPEC.md §9 is explicit that estimates like this get
 * replaced with real historical data as enough closed goals accumulate to
 * fit one. Don't read the number as more precise than that.
 */
export function computeForecast(
  pace: PaceResult,
  target: number,
  current: number,
  thresholds: ForecastThresholds = DEFAULT_FORECAST_THRESHOLDS
): ForecastResult {
  if (current >= target) {
    return { projectedFinal: current, probability: 100, status: "ACHIEVED" };
  }

  const projectedFinal = Math.round((current + pace.currentPace * pace.daysRemaining) * 100) / 100;

  const projectionRatio = target > 0 ? projectedFinal / target : 0;
  const probability = Math.round(Math.min(1, Math.max(0, 2 * projectionRatio - 1)) * 100);

  const paceRatio = pace.expectedByNow > 0 ? current / pace.expectedByNow : current > 0 ? 1 : 0;
  let status: GoalStatus;
  if (pace.daysElapsed === 0) {
    status = "NOT_STARTED";
  } else if (paceRatio >= thresholds.onTrack) {
    status = "ON_TRACK";
  } else if (paceRatio >= thresholds.atRisk) {
    status = "AT_RISK";
  } else if (paceRatio >= thresholds.critical) {
    status = "BEHIND";
  } else {
    status = "CRITICAL";
  }

  return { projectedFinal, probability, status };
}
