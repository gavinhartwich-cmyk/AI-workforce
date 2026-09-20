import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { AgentDefinition, AgentRunResult, AuditSink, ModelRouterLike, PolicyEngine } from "./types.js";
import { ToolRegistry } from "./tool-registry.js";
import { ToolExecutor } from "./tool-executor.js";

/**
 * The one reusable execution pipeline (spec §35):
 *
 *   Agent Definition → Context Builder → Model Router → LLM →
 *   Structured Output → Schema Validation → Policy Check →
 *   Tool Execution → Verification → Audit
 *
 * Every agent runs through this — none of them re-implement model calls,
 * validation, policy checks, or audit logging themselves.
 */
export class AgentRuntime {
  constructor(
    private deps: {
      modelRouter: ModelRouterLike;
      tools: ToolRegistry;
      policy: PolicyEngine;
      audit: AuditSink;
    }
  ) {
    this.executor = new ToolExecutor({ tools: deps.tools, policy: deps.policy });
  }

  private executor: ToolExecutor;

  async run<TInput, TOutput>(
    agent: AgentDefinition<TInput, TOutput>,
    rawInput: unknown,
    context: Record<string, unknown> = {}
  ): Promise<AgentRunResult<TOutput>> {
    const runId = randomUUID();
    const startedAt = new Date();
    const toolCalls: { tool: string; input: unknown; output: unknown }[] = [];

    // 1. Validate input against the agent's own schema before it ever
    // reaches a prompt — a malformed caller never gets to spend a model call.
    const inputResult = agent.inputSchema.safeParse(rawInput);
    if (!inputResult.success) {
      const error = `Input validation failed: ${inputResult.error.message}`;
      await this.deps.audit.record({
        runId,
        agentId: agent.id,
        agentVersion: agent.version,
        model: "n/a",
        startedAt,
        finishedAt: new Date(),
        input: rawInput,
        output: null,
        toolCalls,
        status: "failed",
        error,
      });
      return { status: "failed", error, runId };
    }
    const input = inputResult.data;

    try {
      // 2. Context Builder — the caller already assembled whatever relevant
      // memory/research it retrieved (spec §33: retrieve only relevant
      // context, never dump full history in). The runtime just forwards it
      // into the prompt build step.
      const provider = this.deps.modelRouter.resolve(agent.modelLane);
      const { system, user, jsonSchema } = agent.buildPrompt(input, context);

      // 3. Model Router → LLM → Structured Output (schema-enforced at the
      // provider level, e.g. Groq's strict json_schema or Anthropic's
      // forced tool-use — see src/runtime/model-providers/*).
      const completion = await provider.structuredGenerate({
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        schemaName: `${agent.id}_output`,
        jsonSchema,
        zodSchema: agent.outputSchema as z.ZodType<unknown>,
        maxTokens: agent.maxOutputTokens,
        // Carried so the token ledger can say which agent spent what —
        // agent_runs and groq_token_events shared no key before this, and
        // call counts are a poor proxy for cost between agents whose
        // prompts differ by an order of magnitude in size.
        attribution: { agentId: agent.id, runId },
      });

      // 4. Schema Validation — structuredGenerate already validated against
      // agent.outputSchema; re-checking here would be redundant, but every
      // provider implementation is required to throw rather than return an
      // unvalidated payload, so reaching this line means it's clean.
      const output = completion.parsed as TOutput;

      // 5. Policy Check → Tool Execution → Verification, for any tool the
      // agent's output/reasoning called for. Phase 1 agents don't call
      // tools mid-reasoning yet (that's a later, agentic-loop phase); this
      // loop exists so the runtime already enforces the policy gate for the
      // simplest case — an agent explicitly listing which of its declared
      // tools to invoke with what input, as part of its structured output.
      const toolInvocations = extractToolInvocations(output);
      for (const invocation of toolInvocations) {
        if (!agent.tools.includes(invocation.tool)) {
          throw new Error(
            `Agent "${agent.id}" tried to call "${invocation.tool}", which isn't in its declared tool list.`
          );
        }
        const result = await this.executor.invoke({
          agentId: agent.id,
          autonomyLevel: agent.autonomyLevel,
          toolName: invocation.tool,
          toolInput: invocation.input,
          ctx: { agentId: agent.id, runId },
        });

        if (result.status === "denied") {
          await this.deps.audit.record({
            runId,
            agentId: agent.id,
            agentVersion: agent.version,
            model: completion.model,
            startedAt,
            finishedAt: new Date(),
            input,
            output,
            toolCalls,
            status: "denied",
            error: result.reason,
          });
          return { status: "denied", reason: result.reason, runId };
        }
        if (result.status === "failed") {
          throw new Error(result.error);
        }

        toolCalls.push({ tool: invocation.tool, input: invocation.input, output: result.output });
      }

      // 6. Audit — every run, success or failure, leaves a record
      // (spec §26, §37). This is the institutional memory the manager and
      // analyst phases will read from later.
      await this.deps.audit.record({
        runId,
        agentId: agent.id,
        agentVersion: agent.version,
        model: completion.model,
        startedAt,
        finishedAt: new Date(),
        input,
        output,
        toolCalls,
        status: "succeeded",
      });

      return { status: "succeeded", output, runId };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await this.deps.audit.record({
        runId,
        agentId: agent.id,
        agentVersion: agent.version,
        model: "unknown",
        startedAt,
        finishedAt: new Date(),
        input,
        output: null,
        toolCalls,
        status: "failed",
        error,
      });
      return { status: "failed", error, runId };
    }
  }
}

/**
 * Phase 1 convention: an agent that wants to call a tool includes a
 * `toolCalls?: { tool: string; input: unknown }[]` array in its structured
 * output. Kept as a narrow, explicit escape hatch rather than a general
 * "any field might be a tool call" convention, so agent output schemas stay
 * self-documenting.
 */
function extractToolInvocations(output: unknown): { tool: string; input: unknown }[] {
  if (
    typeof output === "object" &&
    output !== null &&
    "toolCalls" in output &&
    Array.isArray((output as { toolCalls: unknown }).toolCalls)
  ) {
    return (output as { toolCalls: { tool: string; input: unknown }[] }).toolCalls;
  }
  return [];
}
