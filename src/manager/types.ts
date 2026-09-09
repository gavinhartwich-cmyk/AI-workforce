/**
 * SPEC.md §15 — the four operating states a goal moves through as its
 * forecast status changes. Not a new severity scale: derived directly from
 * the same GoalStatus Phase 3's pace-forecast.ts already computes (see
 * src/manager/work-intensity.ts).
 */
export type WorkIntensity = "NORMAL" | "BEHIND" | "AGGRESSIVE" | "CRITICAL";

/** SPEC.md §18's AuthorityPolicy interface, verbatim shape. */
export type AuthorityPolicy = {
  capability: string;
  autonomyLevel: number;
  maxVolume?: number;
  maxBudget?: number;
  maxChangePercent?: number;
  requiresApproval?: boolean;
};

/**
 * What src/manager/intervention-generator.ts proposes before authority is
 * checked. A superset of SPEC.md §36's ManagerDecisionOption — `capability`
 * and `proposedChangePercent` exist only to run the AuthorityPolicy check
 * (src/manager/authority-policy.ts); only the base ManagerDecisionOption
 * fields ever get persisted to manager_decisions.
 */
export type InterventionCandidate = {
  action: string;
  expectedImpact: number;
  confidence: number;
  risk: number;
  /** Matches an AuthorityPolicy.capability — what this action would actually need permission for. */
  capability: string;
  /** Only set for capabilities gated by AuthorityPolicy.maxChangePercent (e.g. "discover_prospects"). */
  proposedChangePercent?: number;
};
