/**
 * SPEC.md §34: "Require sufficient sample size... do not make major
 * strategy decisions from tiny samples." Pure gating logic — the actual
 * per-variant counts come from wherever outcomes end up being tracked
 * (Phase 8's Sales Analyst); this just says whether it's early to look.
 */
export function hasSufficientSample(count: number, minSampleSizePerVariant: number): boolean {
  return count >= minSampleSizePerVariant;
}

export function canDrawConclusion(variantCounts: number[], minSampleSizePerVariant: number): boolean {
  return variantCounts.length > 0 && variantCounts.every((count) => hasSufficientSample(count, minSampleSizePerVariant));
}
