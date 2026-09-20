import type { PolicyDecision, PolicyEngine, ToolDefinition } from "./types.js";

export type PolicyRule = {
  /** Tool name this rule governs, or "*" to match any tool. */
  tool: string;
  /** Minimum autonomy level (spec §31) an agent needs to pass this rule. */
  minAutonomyLevel: number;
};

/**
 * Default, fail-closed Policy Engine (spec §32). Every tool call — read-only
 * or mutating — is checked here before it runs. The default posture is
 * deny: a tool call is only allowed if some rule explicitly covers it at
 * the agent's autonomy level.
 *
 * This is deliberately simple for Phase 1 (rate limits, opt-outs, sending
 * windows, and approval-request creation are later-phase additions per the
 * gap analysis — §5/§10/§32 of the spec) but it is the single choke point
 * every future rule (Phase 5's send policy, opt-out checks, etc.) plugs
 * into, so no agent ever gets a path around it.
 */
export class DefaultPolicyEngine implements PolicyEngine {
  private rules: PolicyRule[];

  constructor(rules: PolicyRule[] = []) {
    this.rules = rules;
  }

  check(input: {
    agentId: string;
    autonomyLevel: number;
    tool: ToolDefinition;
    toolInput: unknown;
  }): PolicyDecision {
    // Read-only tools are always allowed at any autonomy level — the spec's
    // autonomy levels (§31) gate the ability to *act* on the world, not to
    // look at it. Level 0 ("observe only") must still be able to read.
    if (!input.tool.mutating) {
      return { allowed: true };
    }

    const rule =
      this.rules.find((r) => r.tool === input.tool.name) ?? this.rules.find((r) => r.tool === "*");

    if (!rule) {
      return {
        allowed: false,
        reason: `No policy rule covers mutating tool "${input.tool.name}" — denying by default.`,
      };
    }

    if (input.autonomyLevel < rule.minAutonomyLevel) {
      return {
        allowed: false,
        reason: `Tool "${input.tool.name}" requires autonomy level ${rule.minAutonomyLevel}, agent "${input.agentId}" runs at ${input.autonomyLevel}.`,
      };
    }

    return { allowed: true };
  }
}
