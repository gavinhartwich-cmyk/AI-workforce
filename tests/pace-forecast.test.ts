import { describe, expect, it } from "vitest";
import { computePace, computeForecast } from "../src/goals/pace-forecast.js";

const period = { start: new Date("2026-09-01T00:00:00Z"), end: new Date("2026-10-01T00:00:00Z") }; // 30 days

describe("computePace", () => {
  it("computes expected-by-now proportional to elapsed time", () => {
    const asOf = new Date("2026-09-16T00:00:00Z"); // day 15 of 30 — half elapsed
    const pace = computePace(period, 10, 2, asOf);
    expect(pace.daysTotal).toBe(30);
    expect(pace.daysElapsed).toBe(15);
    expect(pace.expectedByNow).toBe(5);
    expect(pace.varianceVsExpected).toBe(-3);
  });

  it("clamps elapsed time to the period bounds", () => {
    const beforeStart = computePace(period, 10, 0, new Date("2026-08-01T00:00:00Z"));
    expect(beforeStart.daysElapsed).toBe(0);
    expect(beforeStart.currentPace).toBe(0);

    const afterEnd = computePace(period, 10, 6, new Date("2026-11-01T00:00:00Z"));
    expect(afterEnd.daysElapsed).toBe(30);
    expect(afterEnd.daysRemaining).toBe(0);
  });

  it("computes the pace required over the remaining days to still hit target", () => {
    const asOf = new Date("2026-09-16T00:00:00Z"); // 15 days elapsed, 15 remaining
    const pace = computePace(period, 10, 2, asOf);
    expect(pace.requiredFuturePace).toBeCloseTo((10 - 2) / 15, 4);
  });
});

describe("computeForecast", () => {
  it("marks a goal ACHIEVED once current meets or exceeds target", () => {
    const pace = computePace(period, 10, 10, new Date("2026-09-16T00:00:00Z"));
    const forecast = computeForecast(pace, 10, 10);
    expect(forecast.status).toBe("ACHIEVED");
    expect(forecast.probability).toBe(100);
  });

  it("projects final value by holding current pace constant over remaining days", () => {
    const asOf = new Date("2026-09-16T00:00:00Z"); // 15 elapsed, 15 remaining
    const pace = computePace(period, 10, 3, asOf); // pace = 0.2/day
    const forecast = computeForecast(pace, 10, 3);
    // projected = 3 + 0.2*15 = 6
    expect(forecast.projectedFinal).toBe(6);
  });

  it("reports NOT_STARTED before any time has elapsed", () => {
    const pace = computePace(period, 10, 0, period.start);
    const forecast = computeForecast(pace, 10, 0);
    expect(forecast.status).toBe("NOT_STARTED");
  });

  it("reports ON_TRACK when current meets or exceeds expected-by-now", () => {
    const asOf = new Date("2026-09-16T00:00:00Z");
    const pace = computePace(period, 10, 5, asOf); // expectedByNow = 5
    const forecast = computeForecast(pace, 10, 5);
    expect(forecast.status).toBe("ON_TRACK");
  });

  it("reports CRITICAL when current pace is far below expected", () => {
    const asOf = new Date("2026-09-16T00:00:00Z"); // expectedByNow = 5
    const pace = computePace(period, 10, 1, asOf); // 1/5 = 0.2 ratio, below the 0.5 critical threshold
    const forecast = computeForecast(pace, 10, 1);
    expect(forecast.status).toBe("CRITICAL");
  });

  it("never reports a probability outside 0-100", () => {
    const asOf = new Date("2026-09-16T00:00:00Z");
    const pace = computePace(period, 10, 0, asOf);
    const forecast = computeForecast(pace, 10, 0);
    expect(forecast.probability).toBeGreaterThanOrEqual(0);
    expect(forecast.probability).toBeLessThanOrEqual(100);
  });
});
