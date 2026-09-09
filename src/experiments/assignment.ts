import { createHash } from "node:crypto";
import type { Experiment, ExperimentVariant } from "./types.js";

/**
 * Deterministic variant assignment: the same (experimentId, prospectId)
 * pair always resolves to the same variant, with no assignment table to
 * maintain — the hash IS the record. Weighted by `variant.weight` via a
 * cumulative-bucket draw against a stable [0,1) value derived from the
 * hash, so unequal weights split proportionally rather than just evenly.
 */
export function assignVariant(experiment: Pick<Experiment, "id" | "variants">, prospectId: string): ExperimentVariant {
  if (experiment.variants.length === 0) {
    throw new Error(`Experiment "${experiment.id}" has no variants to assign.`);
  }

  const hash = createHash("sha256").update(`${experiment.id}:${prospectId}`).digest("hex");
  // First 8 hex chars as a uniform draw in [0, 1).
  const draw = parseInt(hash.slice(0, 8), 16) / 0xffffffff;

  const totalWeight = experiment.variants.reduce((sum, v) => sum + v.weight, 0);
  let cursor = 0;
  for (const variant of experiment.variants) {
    cursor += variant.weight / totalWeight;
    if (draw < cursor) return variant;
  }
  return experiment.variants[experiment.variants.length - 1]; // floating-point fallback
}
