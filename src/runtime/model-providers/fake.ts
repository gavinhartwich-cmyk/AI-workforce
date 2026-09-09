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
      structuredResponse?: unknown;
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
    const result = input.zodSchema.safeParse(this.opts.structuredResponse);
    if (!result.success) {
      throw new Error(`FakeModelProvider's canned response doesn't match the schema: ${result.error.message}`);
    }
    return {
      parsed: result.data,
      usage: { inputTokens: 0, outputTokens: 0 },
      model: this.opts.model ?? "fake-model",
    };
  }
}
