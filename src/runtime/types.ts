/**
 * Core types for the Hartwich agent runtime (spec §35-36).
 *
 * The runtime is intentionally the *only* place that knows how to talk to a
 * model provider, validate structured output, check policy, run a tool, and
 * write an audit record. Individual agents (src/agents/*) supply a
 * definition + a system/user prompt builder + an output schema; they never
 * implement any of that infrastructure themselves (spec §35: "Agents should
 * not independently implement infrastructure that belongs in the runtime").
 */

import type { z } from "zod";

// ---------------------------------------------------------------------------
// Model provider abstraction (spec §36)
// ---------------------------------------------------------------------------

export type ModelMessage = { role: "system" | "user" | "assistant"; content: string };

export type ModelUsage = { inputTokens: number; outputTokens: number };

export type ModelResponse = {
  content: string;
  usage: ModelUsage;
  model: string;
};

export type StructuredResponse<T> = {
  parsed: T;
  usage: ModelUsage;
  model: string;
};

/**
 * A model provider wraps one LLM backend (Groq, Anthropic, ...). Agents and
 * the runtime never call a provider's SDK directly — always through this
 * interface, so swapping/adding providers never touches agent code
 * (spec §36: "the system should support changing providers later without
 * rewriting agents").
 */
export interface ModelProvider {
  readonly id: string;
  generate(input: { messages: ModelMessage[]; maxTokens?: number }): Promise<ModelResponse>;
  structuredGenerate<T>(input: {
    messages: ModelMessage[];
    schemaName: string;
    jsonSchema: Record<string, unknown>;
    zodSchema: z.ZodType<T>;
    maxTokens?: number;
  }): Promise<StructuredResponse<T>>;
}

/**
 * Which lane of work a call is for — the Model Router (spec §36) picks a
 * provider/model per lane, not per agent, so an agent just declares what
 * *kind* of thinking it needs.
 *
 *  - "fast": classification, extraction, normalization, simple routing.
 *  - "strong": difficult research, strategic reasoning, complex
 *    conversations, manager decisions.
 */
export type ModelLane = "fast" | "strong";

/** What the runtime needs from a Model Router — kept separate from the
 * concrete `ModelRouter` class (model-router.ts) so the runtime can be
 * tested against a fake router with no real providers wired up. */
export interface ModelRouterLike {
  resolve(lane: ModelLane): ModelProvider;
}

// ---------------------------------------------------------------------------
// Tools (spec §35, §32 — every external action goes through the policy
// engine, never straight from an agent to the outside world)
// ---------------------------------------------------------------------------

export type ToolContext = {
  agentId: string;
  runId: string;
};

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly description: string;
  /** Whether this tool can change state outside the runtime (send a message,
   * write a CRM record, book a meeting, ...). Read-only tools still go
   * through policy, but a mutating tool is where autonomy level and
   * approval requirements actually bite (spec §31-32). */
  readonly mutating: boolean;
  readonly inputSchema: z.ZodType<TInput>;
  execute(input: TInput, ctx: ToolContext): Promise<TOutput>;
}

// ---------------------------------------------------------------------------
// Policy / permission engine (spec §32)
// ---------------------------------------------------------------------------

export type PolicyDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

export interface PolicyEngine {
  /**
   * Checked before a tool call executes. Never bypassable — the runtime
   * calls this for every tool invocation, mutating or not, so a denial
   * here always wins over whatever the model asked for (spec §10, §32:
   * "No agent should bypass this system").
   */
  check(input: {
    agentId: string;
    autonomyLevel: number;
    tool: ToolDefinition;
    toolInput: unknown;
  }): Promise<PolicyDecision> | PolicyDecision;
}

// ---------------------------------------------------------------------------
// Audit (spec §26, §37 — every meaningful action leaves a record)
// ---------------------------------------------------------------------------

export type AuditRecord = {
  runId: string;
  agentId: string;
  agentVersion: string;
  model: string;
  startedAt: Date;
  finishedAt: Date;
  input: unknown;
  output: unknown;
  toolCalls: { tool: string; input: unknown; output: unknown }[];
  status: "succeeded" | "failed" | "denied";
  error?: string;
};

export interface AuditSink {
  record(entry: AuditRecord): Promise<void>;
}

// ---------------------------------------------------------------------------
// Agent definition (spec §35)
// ---------------------------------------------------------------------------

export interface AgentDefinition<TInput = unknown, TOutput = unknown> {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly capabilities: string[];
  /** Names of tools (from the tool registry) this agent is allowed to call. */
  readonly tools: string[];
  readonly inputSchema: z.ZodType<TInput>;
  readonly outputSchema: z.ZodType<TOutput>;
  /** Level 0 (observe only) .. Level 5 (strategic autonomy) — spec §31. */
  readonly autonomyLevel: number;
  /** Which model lane this agent's reasoning step needs (spec §36). */
  readonly modelLane: ModelLane;
  /** Output token budget for this agent's structured-generate call — falls
   * back to the provider's own default (1024) when omitted. Raise this for
   * an agent whose output schema is naturally large (e.g. a summary plus
   * an array of evidenced signals) rather than one likely to hit the
   * default and return a truncated/invalid document. */
  readonly maxOutputTokens?: number;
  /** Builds the prompt for one run from validated input plus whatever
   * context the caller assembled (research, prior state, ...). Kept as a
   * pure function so it's trivially testable without a live model. */
  buildPrompt(input: TInput, context: Record<string, unknown>): {
    system: string;
    user: string;
    jsonSchema: Record<string, unknown>;
  };
}

export type AgentRunResult<TOutput> =
  | { status: "succeeded"; output: TOutput; runId: string }
  | { status: "denied"; reason: string; runId: string }
  | { status: "failed"; error: string; runId: string };
