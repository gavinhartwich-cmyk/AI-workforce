import { describe, expect, it } from "vitest";
import { deriveWorkIntensity } from "../src/manager/work-intensity.js";
import type { GoalStatus } from "../src/goals/types.js";

describe("deriveWorkIntensity", () => {
  const cases: [GoalStatus, string][] = [
    ["NOT_STARTED", "NORMAL"],
    ["ON_TRACK", "NORMAL"],
    ["ACHIEVED", "NORMAL"],
    ["AT_RISK", "BEHIND"],
    ["BEHIND", "AGGRESSIVE"],
    ["CRITICAL", "CRITICAL"],
    ["FAILED", "CRITICAL"],
  ];

  for (const [status, expected] of cases) {
    it(`maps ${status} -> ${expected}`, () => {
      expect(deriveWorkIntensity(status)).toBe(expected);
    });
  }
});
