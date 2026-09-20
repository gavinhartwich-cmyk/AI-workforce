import type { PolicyEngine, ToolContext, ToolDefinition } from "./types.js";
import type { ToolRegistry } from "./tool-registry.js";

/**
 * The policy-check → input-validation → execute step, factored out of
 * AgentRuntime so it has exactly one implementation. AgentRuntime uses it
 * for tool calls an agent's own structured output requests; pipeline code
 * (e.g. src/pipelines/discover-research-qualify.ts) uses it directly for
 * tool calls a *deterministic* step decides to make — e.g. committing a
 * qualification score that spec SPEC.md §25/§10 requires be computed in
 * code, not by the LLM. Either way, a mutating tool call only ever reaches
 * the outside world (or hartwich-os's database) through this one gate —
 * "no agent should bypass this system" (SPEC.md §19) applies just as much
 * to the runtime's own orchestration code as to a model's output.
 */
export type ToolInvocationResult =
  | { status: "succeeded"; output: unknown }
  | { status: "denied"; reason: string }
  | { status: "failed"; error: string };

export class ToolExecutor {
  constructor(private deps: { tools: ToolRegistry; policy: PolicyEngine }) {}

  async invoke(input: {
    agentId: string;
    autonomyLevel: number;
    toolName: string;
    toolInput: unknown;
    ctx: ToolContext;
  }): Promise<ToolInvocationResult> {
    const tool = this.deps.tools.get(input.toolName);
    if (!tool) {
      return { status: "failed", error: `Tool "${input.toolName}" is not registered.` };
    }

    const decision = await this.deps.policy.check({
      agentId: input.agentId,
      autonomyLevel: input.autonomyLevel,
      tool,
      toolInput: input.toolInput,
    });
    if (!decision.allowed) {
      return { status: "denied", reason: decision.reason };
    }

    const parsed = tool.inputSchema.safeParse(input.toolInput);
    if (!parsed.success) {
      return { status: "failed", error: `Tool "${tool.name}" input failed validation: ${parsed.error.message}` };
    }

    try {
      const output = await tool.execute(parsed.data, input.ctx);
      return { status: "succeeded", output };
    } catch (err) {
      return { status: "failed", error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Direct access to a registered tool's definition — used by callers that
   * need to know `mutating`/`description` without invoking it. */
  get(toolName: string): ToolDefinition | undefined {
    return this.deps.tools.get(toolName);
  }
}
