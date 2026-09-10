import Groq from "groq-sdk";
import type { z } from "zod";
import type { ModelMessage, ModelProvider, ModelResponse, StructuredResponse } from "../types.js";

/**
 * "Fast" lane provider (spec §36) — classification, extraction,
 * normalization, simple routing. Mirrors the strict-JSON-schema pattern
 * already proven in hartwich-os's src/lib/ai/groq-structured.ts (schema
 * validated with Zod, 429s retried with the server's own suggested delay),
 * generalized here so any agent can use it through the ModelProvider
 * interface instead of a bespoke per-feature function.
 */
export class GroqProvider implements ModelProvider {
  readonly id = "groq";
  private client: Groq;
  private model: string;
  private maxRateLimitRetries: number;

  constructor(opts?: { apiKey?: string; model?: string; maxRateLimitRetries?: number }) {
    // Matches hartwich-os's own groq.ts: construct safely even with no key
    // set yet (Groq's SDK throws at construction on `undefined`), fail the
    // call itself with a clean 401 instead.
    this.client = new Groq({ apiKey: opts?.apiKey ?? process.env.GROQ_API_KEY ?? "" });
    this.model = opts?.model ?? process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";
    this.maxRateLimitRetries = opts?.maxRateLimitRetries ?? 3;
  }

  async generate(input: { messages: ModelMessage[]; maxTokens?: number }): Promise<ModelResponse> {
    const response = await this.completionWithRetry({
      messages: input.messages,
      maxTokens: input.maxTokens ?? 1024,
    });
    return {
      content: response.choices[0]?.message?.content ?? "",
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
      model: this.model,
    };
  }

  async structuredGenerate<T>(input: {
    messages: ModelMessage[];
    schemaName: string;
    jsonSchema: Record<string, unknown>;
    zodSchema: z.ZodType<T>;
    maxTokens?: number;
  }): Promise<StructuredResponse<T>> {
    const response = await this.completionWithRetry({
      messages: input.messages,
      maxTokens: input.maxTokens ?? 1024,
      responseFormat: {
        type: "json_schema",
        json_schema: { name: input.schemaName, strict: true, schema: input.jsonSchema },
      },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("Groq returned no content");

    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      throw new Error(`Groq structured response was not valid JSON: ${content.slice(0, 200)}`);
    }

    const result = input.zodSchema.safeParse(raw);
    if (!result.success) {
      throw new Error(`Groq structured response failed schema validation: ${result.error.message}`);
    }

    return {
      parsed: result.data,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
      model: this.model,
    };
  }

  // Groq's free/on-demand tier caps at 8000 tokens/minute — a 429 there
  // means "wait, don't give up." Same retry shape as hartwich-os's
  // groq-structured.ts, generalized to cover both generate() and
  // structuredGenerate().
  private async completionWithRetry(opts: {
    messages: ModelMessage[];
    maxTokens: number;
    responseFormat?: {
      type: "json_schema";
      json_schema: { name: string; strict: true; schema: Record<string, unknown> };
    };
  }) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.client.chat.completions.create({
          model: this.model,
          max_completion_tokens: opts.maxTokens,
          messages: opts.messages,
          ...(opts.responseFormat ? { response_format: opts.responseFormat } : {}),
        });
      } catch (err) {
        // A daily-budget 429 won't clear on any timescale worth blocking a
        // cycle for — fail fast so the caller can record it and move on.
        if (isRateLimitError(err) && isDailyTokenLimitError(err)) throw err;
        if (isRateLimitError(err) && attempt < this.maxRateLimitRetries) {
          await sleep(retryDelayMs(err));
          continue;
        }
        throw err;
      }
    }
  }
}

function isRateLimitError(err: unknown): err is { status: number; message?: string } {
  return typeof err === "object" && err !== null && "status" in err && (err as { status: unknown }).status === 429;
}

/**
 * True for a 429 against the *daily* token allowance (TPD) rather than the
 * per-minute one (TPM). Groq words it as e.g. "Rate limit reached ... on
 * tokens per day (TPD): Limit 200000, Used 198528".
 *
 * Worth distinguishing because the two want opposite handling: a TPM 429
 * clears in seconds and should be waited out, while a TPD 429 means the
 * day's budget is gone — retrying just burns the retry allowance and
 * delays the caller for nothing.
 */
export function isDailyTokenLimitError(err: { message?: string }): boolean {
  return /tokens per day|\bTPD\b/i.test(err.message ?? "");
}

/**
 * Groq's suggested wait, in ms. The duration is a Go-style string, so it
 * can carry hour/minute parts ("7m59.52s", "1h2m3s") — parsing only a
 * bare `([\d.]+)s` silently missed those and fell back to the 5s default,
 * which meant a 7-minute wait got retried 3 times over ~15 seconds and
 * failed anyway (Gavin, 2026-09-10).
 */
function retryDelayMs(err: { message?: string }): number {
  const match = err.message?.match(/try again in (?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/i);
  if (!match || (!match[1] && !match[2] && !match[3])) return 5000;
  const seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) + 250 : 5000;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
