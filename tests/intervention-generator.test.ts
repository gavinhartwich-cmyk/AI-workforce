import { describe, expect, it } from "vitest";
import { generateInterventionOptions } from "../src/manager/intervention-generator.js";
import type { BottleneckDiagnosis, StageConversion } from "../src/goals/types.js";

function bottleneck(overrides: Partial<StageConversion> | null): BottleneckDiagnosis {
  const primaryBottleneck: StageConversion | null = overrides && {
    fromStage: "prospects_discovered",
    toStage: "qualified_prospects",
    volumeFrom: 100,
    volumeTo: 40,
    actualConversionRate: 0.4,
    targetConversionRate: 0.5,
    variance: -0.1,
    impactOnFinalStage: 2.5,
    ...overrides,
  };
  return { stages: [], conversions: [], primaryBottleneck, observation: "obs", diagnosis: "diag" };
}

describe("generateInterventionOptions", () => {
  it("returns no candidates when intensity is NORMAL, even with a real bottleneck", () => {
    expect(generateInterventionOptions(bottleneck({}), "NORMAL")).toEqual([]);
  });

  it("returns no candidates when there's nothing to diagnose", () => {
    expect(generateInterventionOptions(bottleneck(null), "CRITICAL")).toEqual([]);
  });

  it("proposes increasing discovery volume for an upstream bottleneck", () => {
    const [candidate] = generateInterventionOptions(
      bottleneck({ fromStage: "prospects_discovered", toStage: "qualified_prospects", impactOnFinalStage: 3 }),
      "BEHIND"
    );
    expect(candidate.capability).toBe("discover_prospects");
    expect(candidate.proposedChangePercent).toBe(20);
    expect(candidate.expectedImpact).toBe(3);
  });

  it("proposes a controlled experiment for a downstream bottleneck", () => {
    const [candidate] = generateInterventionOptions(
      bottleneck({ fromStage: "contacted", toStage: "engaged", impactOnFinalStage: 1.5 }),
      "AGGRESSIVE"
    );
    expect(candidate.capability).toBe("create_controlled_experiment");
    expect(candidate.proposedChangePercent).toBeUndefined();
    expect(candidate.expectedImpact).toBe(1.5);
  });

  it("asks for a bigger discovery increase and takes on more risk as intensity rises", () => {
    const behind = generateInterventionOptions(bottleneck({}), "BEHIND")[0];
    const critical = generateInterventionOptions(bottleneck({}), "CRITICAL")[0];
    expect(behind.proposedChangePercent).toBe(20);
    expect(critical.proposedChangePercent).toBe(100);
    expect(critical.risk).toBeGreaterThan(behind.risk);
  });

  it("treats a null impactOnFinalStage as zero expected impact rather than throwing", () => {
    const [candidate] = generateInterventionOptions(bottleneck({ impactOnFinalStage: null }), "BEHIND");
    expect(candidate.expectedImpact).toBe(0);
  });
});
