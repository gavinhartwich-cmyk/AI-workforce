import { describe, expect, it } from "vitest";
import { computeQualificationScore, tierForScore, DEFAULT_QUALIFICATION_CONFIG } from "../src/qualification/scoring.js";

const allEqual = (n: number) => ({
  icpFit: n,
  opportunity: n,
  contactability: n,
  businessQuality: n,
  timing: n,
  dataConfidence: n,
});

describe("tierForScore", () => {
  it("maps score bands to tiers", () => {
    expect(tierForScore(95)).toBe("A+");
    expect(tierForScore(90)).toBe("A+");
    expect(tierForScore(89)).toBe("A");
    expect(tierForScore(75)).toBe("A");
    expect(tierForScore(74)).toBe("B");
    expect(tierForScore(60)).toBe("B");
    expect(tierForScore(59)).toBe("C");
    expect(tierForScore(40)).toBe("C");
    expect(tierForScore(39)).toBe("D");
    expect(tierForScore(0)).toBe("D");
  });
});

describe("computeQualificationScore", () => {
  it("weights each dimension per SPEC.md §25 (30/25/15/15/10/5)", () => {
    // Only icpFit at 100, everything else 0 — result should equal the icpFit weight.
    const result = computeQualificationScore({
      icpFit: 100,
      opportunity: 0,
      contactability: 0,
      businessQuality: 0,
      timing: 0,
      dataConfidence: 0,
    });
    expect(result.score).toBe(30);
  });

  it("is deterministic and reproducible for identical input", () => {
    const subscores = { icpFit: 82, opportunity: 61, contactability: 40, businessQuality: 70, timing: 50, dataConfidence: 90 };
    const a = computeQualificationScore(subscores);
    const b = computeQualificationScore(subscores);
    expect(a).toEqual(b);
  });

  it("clamps out-of-range subscores instead of throwing", () => {
    const result = computeQualificationScore(allEqual(150));
    expect(result.score).toBe(100);
    expect(result.tier).toBe("A+");
  });

  it("auto-files (status: qualified) at or above the auto-file threshold", () => {
    const result = computeQualificationScore(allEqual(60));
    expect(result.score).toBe(60);
    expect(result.status).toBe("qualified");
  });

  it("disqualifies below the disqualify threshold", () => {
    const result = computeQualificationScore(allEqual(39));
    expect(result.status).toBe("disqualified");
  });

  it("routes the middle band to needs_review", () => {
    const result = computeQualificationScore(allEqual(50));
    expect(result.status).toBe("needs_review");
  });

  it("throws if a caller-supplied weight config doesn't sum to 1", () => {
    expect(() =>
      computeQualificationScore(allEqual(50), { ...DEFAULT_QUALIFICATION_CONFIG, weights: { ...DEFAULT_QUALIFICATION_CONFIG.weights, icpFit: 0.9 } })
    ).toThrow(/must sum to 1/);
  });
});
