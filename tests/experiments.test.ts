import { describe, expect, it } from "vitest";
import { assignVariant } from "../src/experiments/assignment.js";
import { canDrawConclusion, hasSufficientSample } from "../src/experiments/sample-size.js";
import type { Experiment } from "../src/experiments/types.js";

const experiment: Pick<Experiment, "id" | "variants"> = {
  id: "exp-1",
  variants: [
    { id: "a", name: "Variant A", directive: "Lead with the review-count gap.", weight: 1 },
    { id: "b", name: "Variant B", directive: "Lead with the rating gap.", weight: 1 },
  ],
};

describe("assignVariant", () => {
  it("is deterministic for the same experiment/prospect pair", () => {
    const first = assignVariant(experiment, "company-123");
    const second = assignVariant(experiment, "company-123");
    expect(first.id).toBe(second.id);
  });

  it("distributes across variants roughly evenly over many prospects", () => {
    const counts: Record<string, number> = { a: 0, b: 0 };
    for (let i = 0; i < 1000; i++) {
      const variant = assignVariant(experiment, `company-${i}`);
      counts[variant.id]++;
    }
    // Not a statistical test, just a sanity check that neither variant gets everything.
    expect(counts.a).toBeGreaterThan(300);
    expect(counts.b).toBeGreaterThan(300);
  });

  it("respects unequal weights", () => {
    const skewed: Pick<Experiment, "id" | "variants"> = {
      id: "exp-2",
      variants: [
        { id: "a", name: "A", directive: "d", weight: 9 },
        { id: "b", name: "B", directive: "d", weight: 1 },
      ],
    };
    const counts: Record<string, number> = { a: 0, b: 0 };
    for (let i = 0; i < 1000; i++) {
      counts[assignVariant(skewed, `company-${i}`).id]++;
    }
    expect(counts.a).toBeGreaterThan(counts.b * 3);
  });

  it("throws for an experiment with no variants", () => {
    expect(() => assignVariant({ id: "empty", variants: [] }, "company-1")).toThrow(/no variants/);
  });
});

describe("sample-size gating", () => {
  it("requires at least the configured minimum", () => {
    expect(hasSufficientSample(29, 30)).toBe(false);
    expect(hasSufficientSample(30, 30)).toBe(true);
  });

  it("only allows a conclusion once every variant has enough samples", () => {
    expect(canDrawConclusion([30, 30], 30)).toBe(true);
    expect(canDrawConclusion([30, 29], 30)).toBe(false);
    expect(canDrawConclusion([], 30)).toBe(false);
  });
});
