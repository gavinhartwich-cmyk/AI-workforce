/**
 * Deterministic qualification scoring (SPEC.md §25, and the original V1
 * spec's §7 numeric detail this repo still follows): the model produces
 * per-dimension sub-scores with reasoning (src/agents/prospect-assessment-agent.ts),
 * but the weighted formula that turns those into a final score/tier/status
 * is plain code — "do not let the LLM silently modify the scoring formula."
 */

export type QualificationSubscores = {
  icpFit: number; // 0-100
  opportunity: number;
  contactability: number;
  businessQuality: number;
  timing: number;
  dataConfidence: number;
};

export type QualificationWeights = {
  icpFit: number;
  opportunity: number;
  contactability: number;
  businessQuality: number;
  timing: number;
  dataConfidence: number;
};

export type QualificationConfig = {
  weights: QualificationWeights;
  /** score >= this → status "qualified" (auto-filed, a deal is created). */
  autoFileThreshold: number;
  /** score < this → status "disqualified". Between the two → "needs_review". */
  disqualifyThreshold: number;
};

// Weights and thresholds are configuration, not agent code — tightening or
// loosening the HVAC qualification bar (Gavin, 2026-09-09: HVAC stays the
// ICP, but its thresholds are still config) is a change here, never a
// prompt edit.
export const DEFAULT_QUALIFICATION_CONFIG: QualificationConfig = {
  weights: {
    icpFit: 0.3,
    opportunity: 0.25,
    contactability: 0.15,
    businessQuality: 0.15,
    timing: 0.1,
    dataConfidence: 0.05,
  },
  autoFileThreshold: 60, // tier B and above auto-file
  disqualifyThreshold: 40, // tier D disqualifies
};

export type QualificationTier = "A+" | "A" | "B" | "C" | "D";

export function tierForScore(score: number): QualificationTier {
  if (score >= 90) return "A+";
  if (score >= 75) return "A";
  if (score >= 60) return "B";
  if (score >= 40) return "C";
  return "D";
}

export type QualificationOutcome = {
  score: number; // 0-100, rounded
  tier: QualificationTier;
  status: "qualified" | "needs_review" | "disqualified";
};

function clamp(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export function computeQualificationScore(
  subscores: QualificationSubscores,
  config: QualificationConfig = DEFAULT_QUALIFICATION_CONFIG
): QualificationOutcome {
  const weightSum = Object.values(config.weights).reduce((a, b) => a + b, 0);
  if (Math.abs(weightSum - 1) > 0.001) {
    throw new Error(`Qualification weights must sum to 1 (got ${weightSum}) — check QualificationConfig.weights.`);
  }

  const weighted =
    clamp(subscores.icpFit) * config.weights.icpFit +
    clamp(subscores.opportunity) * config.weights.opportunity +
    clamp(subscores.contactability) * config.weights.contactability +
    clamp(subscores.businessQuality) * config.weights.businessQuality +
    clamp(subscores.timing) * config.weights.timing +
    clamp(subscores.dataConfidence) * config.weights.dataConfidence;

  const score = Math.round(clamp(weighted));
  const tier = tierForScore(score);
  const status: QualificationOutcome["status"] =
    score < config.disqualifyThreshold ? "disqualified" : score >= config.autoFileThreshold ? "qualified" : "needs_review";

  return { score, tier, status };
}
