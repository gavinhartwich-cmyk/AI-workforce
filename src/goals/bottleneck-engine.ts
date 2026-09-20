import type { BottleneckDiagnosis, FunnelStageVolume, StageConversion } from "./types.js";

/**
 * Bottleneck Engine (SPEC.md §13): for every adjacent stage pair, compute
 * actual vs. target conversion, then estimate each underperforming step's
 * impact on the final stage — how many more units would reach the end if
 * *only* that step's rate matched target, holding every other step's
 * performance fixed. The step with the largest impact is the primary
 * bottleneck (SPEC.md §14: diagnose before acting, don't just increase
 * every stage's volume).
 *
 * Pure function of the stage volumes and a target-rate table — no I/O, no
 * model call.
 */
export function detectBottleneck(
  stages: FunnelStageVolume[],
  targetRates: Record<string, number>
): BottleneckDiagnosis {
  const topVolume = stages[0]?.volume ?? 0;
  const finalVolume = stages[stages.length - 1]?.volume ?? 0;

  if (stages[0]?.volume === 0) {
    return {
      stages,
      conversions: [],
      primaryBottleneck: null,
      observation: "No prospects were discovered in this period.",
      diagnosis:
        "Nothing to diagnose yet — the funnel is empty at the top. Prospect Discovery needs to run before any downstream stage can be evaluated.",
    };
  }

  const conversions: StageConversion[] = [];
  for (let i = 0; i < stages.length - 1; i++) {
    const from = stages[i];
    const to = stages[i + 1];
    const key = `${from.stage}->${to.stage}`;
    // Rate is genuinely undefined (null) only when nothing ever reached
    // `from` — 0 units converting out of a nonzero `from` is a real,
    // meaningful 0% rate, not a missing measurement.
    const actualConversionRate =
      from.volume != null && from.volume > 0 && to.volume != null ? to.volume / from.volume : null;
    const targetConversionRate = targetRates[key] ?? null;
    const variance =
      actualConversionRate != null && targetConversionRate != null ? actualConversionRate - targetConversionRate : null;

    conversions.push({
      fromStage: from.stage,
      toStage: to.stage,
      volumeFrom: from.volume,
      volumeTo: to.volume,
      actualConversionRate,
      targetConversionRate,
      variance,
      impactOnFinalStage: null, // filled below, once every step's rate is known
    });
  }

  // Effective rate for projection purposes: real data when we have it,
  // else fall back to that step's own target (SPEC.md §9) — otherwise a
  // single undefined downstream rate (e.g. nothing has ever reached
  // Engaged yet) would silently kill every impact estimate that depends
  // on passing through it.
  const effectiveRate = (c: StageConversion): number | null => c.actualConversionRate ?? c.targetConversionRate;

  for (let i = 0; i < conversions.length; i++) {
    const candidate = conversions[i];
    if (candidate.targetConversionRate == null) continue; // nothing to compare against
    if ((candidate.actualConversionRate ?? 0) >= candidate.targetConversionRate) continue; // not underperforming

    let projected = topVolume;
    let computable = true;
    for (let j = 0; j < conversions.length; j++) {
      const rate = j === i ? candidate.targetConversionRate : effectiveRate(conversions[j]);
      if (rate == null) {
        computable = false;
        break;
      }
      projected *= rate;
    }
    if (!computable) continue;

    candidate.impactOnFinalStage = Math.round((projected - finalVolume) * 100) / 100;
  }

  const ranked = conversions.filter((c) => c.impactOnFinalStage != null && c.impactOnFinalStage > 0);
  const primaryBottleneck =
    ranked.length > 0 ? ranked.reduce((best, c) => (c.impactOnFinalStage! > best.impactOnFinalStage! ? c : best)) : null;

  const observation = `${topVolume} prospect(s) discovered, ${finalVolume} won as client(s) this period.`;
  const diagnosis = primaryBottleneck
    ? `The ${primaryBottleneck.fromStage} → ${primaryBottleneck.toStage} conversion (${formatRate(
        primaryBottleneck.actualConversionRate
      )} actual vs. ${formatRate(
        primaryBottleneck.targetConversionRate
      )} target) is the highest-impact gap — closing it alone is estimated at +${
        primaryBottleneck.impactOnFinalStage
      } at the final stage, holding every other stage's current performance fixed.`
    : "Every measurable conversion is at or above its target rate for this period — no code-diagnosable bottleneck found.";

  return { stages, conversions, primaryBottleneck, observation, diagnosis };
}

function formatRate(rate: number | null): string {
  return rate != null ? `${Math.round(rate * 1000) / 10}%` : "n/a";
}
