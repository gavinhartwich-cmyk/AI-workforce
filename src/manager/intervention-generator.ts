import type { BottleneckDiagnosis } from "../goals/types.js";
import type { InterventionCandidate, WorkIntensity } from "./types.js";

/** Stages where the fix is "find more raw material," not "change the message." */
const UPSTREAM_STAGES = new Set(["prospects_discovered", "qualified_prospects"]);

/** SPEC.md §15: how large an ask the manager makes scales with how far behind the goal is. */
function proposedIncreasePercent(intensity: WorkIntensity): number {
  switch (intensity) {
    case "NORMAL":
      return 0;
    case "BEHIND":
      return 20;
    case "AGGRESSIVE":
      return 50;
    case "CRITICAL":
      return 100;
  }
}

/**
 * SPEC.md §14 steps 2-5: diagnose (already done by Phase 3's
 * detectBottleneck), generate possible interventions, estimate expected
 * impact, consider risk. Deliberately produces at most ONE real candidate
 * — this repo has exactly two levers that actually exist and are safe to
 * fire autonomously (more Prospect Discovery volume upstream, a controlled
 * experiment downstream), not a menu of hypothetical options with
 * made-up numbers to choose between. `expectedImpact` reuses
 * detectBottleneck's own `impactOnFinalStage` — a real number derived from
 * real conversion data, not a new estimate invented here.
 *
 * Confidence/risk are honest, documented placeholders (same spirit as
 * pace-forecast.ts's own probability heuristic) — discovery volume is the
 * better-understood lever (more raw material reliably produces more
 * qualified leads, if the ICP itself is sound), so it gets a higher
 * confidence than a brand-new, unmeasured experiment.
 */
export function generateInterventionOptions(
  bottleneck: BottleneckDiagnosis,
  intensity: WorkIntensity
): InterventionCandidate[] {
  if (intensity === "NORMAL" || !bottleneck.primaryBottleneck) return [];

  const { fromStage, toStage, impactOnFinalStage } = bottleneck.primaryBottleneck;
  const expectedImpact = impactOnFinalStage ?? 0;
  const changePercent = proposedIncreasePercent(intensity);

  if (UPSTREAM_STAGES.has(fromStage)) {
    return [
      {
        action: `Increase Prospect Discovery volume by ${changePercent}% to relieve the ${fromStage} → ${toStage} bottleneck.`,
        expectedImpact,
        confidence: 0.6,
        risk: changePercent > 20 ? 0.3 : 0.15,
        capability: "discover_prospects",
        proposedChangePercent: changePercent,
      },
    ];
  }

  return [
    {
      action: `Start a controlled experiment testing an alternate outreach approach at the ${fromStage} → ${toStage} step.`,
      expectedImpact,
      confidence: 0.4, // no data yet — a new experiment, not a measured lever
      risk: 0.2,
      capability: "create_controlled_experiment",
    },
  ];
}
