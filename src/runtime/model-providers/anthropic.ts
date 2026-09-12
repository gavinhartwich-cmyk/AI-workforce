import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import type { ModelMessage, ModelProvider, ModelResponse, StructuredResponse } from "../types.js";

/**
 * "Strong" lane provider (spec §36) — difficult research, strategic
 * reasoning, complex conversations, Sales Manager decisions.
 *
 * Anthropic usage was blocked under hartwich-os's $0 development-budget
 * constraint (see GAP_ANALYSIS.md §8); Gavin has since lifted that
 * restriction specifically for Claude, so this is a live provider, not a
 * stub — but it is still real API spend. Callers pick this lane
 * deliberately (via an agent's `modelLane: "strong"`, spec §35), not by
 * default, so cost stays tied to work that actually needs it.
 */
export class AnthropicProvider implements ModelProvider {
  readonly id = "anthropic";
  private client: Anthropic;
  private model: string;

  constructor(opts?: { apiKey?: string; model?: string }) {
    this.client = new Anthropic({ apiKey: opts?.apiKey ?? process.env.ANTHROPIC_API_KEY });
    // claude-sonnet-5 by default — the current balance of capability/cost
    // for agent reasoning. Override per-deployment via ANTHROPIC_MODEL
    // (e.g. claude-opus-5 for Sales Manager decisions once that phase
    // exists) without touching provider code.
    this.model = opts?.model ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";
  }

  async generate(input: { messages: ModelMessage[]; maxTokens?: number }): Promise<ModelResponse> {
    const { system, rest } = splitSystem(input.messages);
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: input.maxTokens ?? 1024,
      system,
      messages: rest,
    });

    const content = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    return {
      content,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      model: this.model,
    };
  }

  /**
   * Structured output via a single forced tool call — Anthropic has no
   * native `json_schema` response mode (unlike Groq's strict mode), so a
   * tool whose input_schema *is* the desired shape, with tool_choice
   * forced to it, is the standard way to get schema-shaped JSON back
   * (docs.anthropic.com/en/docs/build-with-claude/tool-use).
   */
  async structuredGenerate<T>(input: {
    messages: ModelMessage[];
    schemaName: string;
    jsonSchema: Record<string, unknown>;
    zodSchema: z.ZodType<T>;
    maxTokens?: number;
  }): Promise<StructuredResponse<T>> {
    const { system, rest } = splitSystem(input.messages);

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: input.maxTokens ?? 1024,
      system,
      messages: rest,
      tools: [
        {
          name: input.schemaName,
          description: `Return the result as structured data matching the ${input.schemaName} shape.`,
          input_schema: input.jsonSchema as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: input.schemaName },
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );
    if (!toolUse) throw new Error("Anthropic response had no tool_use block");

    const result = input.zodSchema.safeParse(toolUse.input);
    if (!result.success) {
      throw new Error(`Anthropic structured response failed schema validation: ${result.error.message}`);
    }

    return {
      parsed: result.data,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      model: this.model,
    };
  }
}

function splitSystem(messages: ModelMessage[]): {
  system: string | undefined;
  rest: { role: "user" | "assistant"; content: string }[];
} {
  const systemMessages = messages.filter((m) => m.role === "system").map((m) => m.content);
  const rest = messages
    .filter((m): m is ModelMessage & { role: "user" | "assistant" } => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));
  return { system: systemMessages.length > 0 ? systemMessages.join("\n\n") : undefined, rest };
}
