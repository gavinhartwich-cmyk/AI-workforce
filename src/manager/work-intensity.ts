import type { GoalStatus } from "../goals/types.js";
import type { WorkIntensity } from "./types.js";

/**
 * SPEC.md §15: NORMAL/BEHIND/AGGRESSIVE/CRITICAL, derived from the same
 * forecast status Phase 3's pace-forecast.ts already computes — not a
 * second, competing severity scale, and not configurable multipliers
 * (§15: "do not hard-code multipliers — use configurable policies," which
 * is exactly what src/manager/authority-policy.ts is for; this mapping
 * itself is just which of four buckets a status falls into).
 *
 * NOT_STARTED/ON_TRACK/ACHIEVED all read as NORMAL — nothing about the
 * current pace calls for an intervention. CRITICAL and FAILED both read as
 * CRITICAL: a goal whose period already ended still short is exactly the
 * situation §15 describes ("attempt recovery while preparing escalation to
 * Gavin") even though GoalStore.listActive() already excludes FAILED goals
 * from new intervention cycles — this function stays honest about what the
 * status means regardless of who calls it.
 */
export function deriveWorkIntensity(status: GoalStatus): WorkIntensity {
  switch (status) {
    case "NOT_STARTED":
    case "ON_TRACK":
    case "ACHIEVED":
      return "NORMAL";
    case "AT_RISK":
      return "BEHIND";
    case "BEHIND":
      return "AGGRESSIVE";
    case "CRITICAL":
    case "FAILED":
      return "CRITICAL";
  }
}
