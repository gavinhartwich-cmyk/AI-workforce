import type { z } from "zod";
import type { ModelMessage, ModelProvider, ModelResponse, StructuredResponse } from "../types.js";

/**
 * Deterministic, no-network provider — for tests and for anyone exploring
 * the runtime without spending on a real API. Returns whatever the caller
 * hands it, so tests control the "model's" behavior precisely instead of
 * being at the mercy of a live model's actual output.
 */
export class FakeModelProvider implements ModelProvider {
  readonly id = "fake";

  constructor(
    private opts: {
      model?: string;
      generateResponse?: string;
      /** Used when `responsesBySchema` doesn't have an entry for the call's schemaName. */
      structuredResponse?: unknown;
      /** Keyed by `schemaName` (== `${agent.id}_output`) — lets one provider
       * serve a multi-agent pipeline test with a different canned response
       * per agent, instead of one response for every call. */
      responsesBySchema?: Record<string, unknown>;
    } = {}
  ) {}

  async generate(_input: { messages: ModelMessage[]; maxTokens?: number }): Promise<ModelResponse> {
    return {
      content: this.opts.generateResponse ?? "",
      usage: { inputTokens: 0, outputTokens: 0 },
      model: this.opts.model ?? "fake-model",
    };
  }

  async structuredGenerate<T>(input: {
    messages: ModelMessage[];
    schemaName: string;
    jsonSchema: Record<string, unknown>;
    zodSchema: z.ZodType<T>;
    maxTokens?: number;
  }): Promise<StructuredResponse<T>> {
    const canned = this.opts.responsesBySchema?.[input.schemaName] ?? this.opts.structuredResponse;
    const result = input.zodSchema.safeParse(canned);
    if (!result.success) {
      throw new Error(
        `FakeModelProvider has no valid canned response for schema "${input.schemaName}": ${result.error.message}`
      );
    }
    return {
      parsed: result.data,
      usage: { inputTokens: 0, outputTokens: 0 },
      model: this.opts.model ?? "fake-model",
    };
  }
}
