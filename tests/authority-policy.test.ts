import { describe, expect, it } from "vitest";
import { checkAuthority, DEFAULT_AUTHORITY_POLICIES } from "../src/manager/authority-policy.js";
import { AUTONOMY } from "../src/runtime/autonomy-levels.js";

describe("checkAuthority", () => {
  it("allows a discovery volume increase within the autonomous cap", () => {
    const result = checkAuthority("discover_prospects", 20, AUTONOMY.MANAGER_COORDINATION);
    expect(result.allowed).toBe(true);
  });

  it("denies a discovery volume increase beyond the autonomous cap", () => {
    const result = checkAuthority("discover_prospects", 100, AUTONOMY.MANAGER_COORDINATION);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toMatch(/exceeds the autonomous cap/);
  });

  it("allows creating a controlled experiment with no change-percent gate", () => {
    const result = checkAuthority("create_controlled_experiment", undefined, AUTONOMY.MANAGER_COORDINATION);
    expect(result.allowed).toBe(true);
  });

  it("denies by default when no policy covers the capability (fail-closed, SPEC.md §19)", () => {
    const result = checkAuthority("change_pricing", undefined, AUTONOMY.STRATEGIC);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toMatch(/No authority policy covers/);
  });

  it("denies when the agent's autonomy level is below the policy's requirement", () => {
    const result = checkAuthority("discover_prospects", 10, AUTONOMY.RECOMMEND);
    expect(result.allowed).toBe(false);
  });

  it("denies unconditionally when a policy sets requiresApproval", () => {
    const policies = [...DEFAULT_AUTHORITY_POLICIES, { capability: "change_offer", autonomyLevel: 0, requiresApproval: true }];
    const result = checkAuthority("change_offer", undefined, AUTONOMY.STRATEGIC, policies);
    expect(result.allowed).toBe(false);
  });
});
