import { describe, expect, it } from "vitest";
import { UnlimitedTokenBudget, utcDateKey, type BudgetState, type TokenBudget } from "../src/runtime/token-budget.js";
import { DiscoverResearchQualifyPipeline } from "../src/pipelines/discover-research-qualify.js";
import { ToolRegistry } from "../src/runtime/tool-registry.js";
import { DefaultPolicyEngine } from "../src/runtime/policy-engine.js";
import { DEFAULT_POLICY_RULES } from "../src/policy/default-rules.js";
import { InMemoryAuditSink } from "../src/runtime/audit-sink.js";
import type { AgentRuntime } from "../src/runtime/agent-runtime.js";

/** Budget with a fixed remaining balance, for asserting the gate's behaviour. */
function budgetWith(remaining: number): TokenBudget {
  return {
    async record() {},
    async state(): Promise<BudgetState> {
      return { usedToday: 160_000 - remaining, budget: 160_000, remaining, exhausted: remaining <= 0 };
    },
  };
}

describe("utcDateKey", () => {
  it("keys by UTC day, not local time", () => {
    // 23:30 in Winnipeg on Jan 6 is already Jan 7 in UTC — Groq's cap tracks
    // the UTC window, so that's the day this has to attribute tokens to.
    expect(utcDateKey(new Date("2026-01-07T05:30:00Z"))).toBe("2026-01-07");
    expect(utcDateKey(new Date("2026-01-07T23:59:59Z"))).toBe("2026-01-07");
    expect(utcDateKey(new Date("2026-01-08T00:00:01Z"))).toBe("2026-01-08");
  });
});

describe("UnlimitedTokenBudget", () => {
  it("never reports exhausted", async () => {
    const state = await new UnlimitedTokenBudget().state();
    expect(state.exhausted).toBe(false);
    expect(state.remaining).toBe(Infinity);
  });
});

describe("discovery pipeline budget gate", () => {
  const runtime = {
    run: async () => {
      throw new Error("runtime.run should not be reached when the budget is spent");
    },
  } as unknown as AgentRuntime;

  function pipelineWith(budget: TokenBudget) {
    return new DiscoverResearchQualifyPipeline({
      runtime,
      tools: new ToolRegistry(),
      policy: new DefaultPolicyEngine(DEFAULT_POLICY_RULES),
      audit: new InMemoryAuditSink(),
      budget,
    });
  }

  it("skips the whole run — including the paid Places search — when the budget is spent", async () => {
    // An empty ToolRegistry means search_google_places would throw if it were
    // reached, so a clean empty summary proves the gate ran first.
    const summary = await pipelineWith(budgetWith(0)).run({ area: "Winnipeg, MB", keyword: "hvac" });
    expect(summary).toEqual({ found: 0, results: [] });
  });

  it("does not gate when budget remains", async () => {
    // Budget left, so it proceeds far enough to hit the missing tool —
    // the opposite outcome from the skip case above.
    await expect(pipelineWith(budgetWith(50_000)).run({ area: "Winnipeg, MB", keyword: "hvac" })).rejects.toThrow();
  });
});
