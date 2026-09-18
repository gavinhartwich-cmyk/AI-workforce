import { z } from "zod";
import type { AgentDefinition } from "../runtime/types.js";

/**
 * Phase 1's proof-of-pipeline agent (spec's Phase 1 "Definition of done").
 * Deliberately small in scope: given a company id and the reason it was
 * surfaced for review, decide whether pulling the full CRM record via the
 * `get_company` tool would help a human reviewer, and say so.
 *
 * Known Phase 1 limitation, by design: the runtime (agent-runtime.ts) is a
 * single reasoning pass — a tool call requested in this agent's output
 * executes and gets audited, but its result isn't fed back for a second,
 * better-informed answer. That "look something up, then reason further
 * about what came back" loop is real agentic behavior later phases will
 * need (e.g. Research/Qualification); Phase 1 only has to prove input →
 * reason → structured output → policy-checked tool call → validation →
 * audit end to end, which this agent does honestly without pretending to
 * be smarter than a one-shot model call.
 */

const InputSchema = z.object({
  companyId: z.string().uuid(),
  reason: z.string().min(1),
});

const ToolCallSchema = z.object({
  tool: z.literal("get_company"),
  input: z.object({ companyId: z.string() }),
});

const OutputSchema = z.object({
  assessment: z.string(),
  needsCompanyRecord: z.boolean(),
  toolCalls: z.array(ToolCallSchema).max(1),
});

export type CompanyReviewInput = z.infer<typeof InputSchema>;
export type CompanyReviewOutput = z.infer<typeof OutputSchema>;

// Hand-written to Groq's strict json_schema dialect (every property in
// `required`, every object `additionalProperties: false`) — the same
// convention hartwich-os's own Groq call sites use (see
// hartwich-os/src/lib/ai/enrich-company.ts). This dialect is a strict
// superset of what Anthropic's forced tool-use accepts, so the same schema
// works unmodified against either provider.
const JSON_SCHEMA = {
  type: "object",
  properties: {
    assessment: { type: "string" },
    needsCompanyRecord: { type: "boolean" },
    toolCalls: {
      type: "array",
      items: {
        type: "object",
        properties: {
          tool: { type: "string", enum: ["get_company"] },
          input: {
            type: "object",
            properties: { companyId: { type: "string" } },
            required: ["companyId"],
            additionalProperties: false,
          },
        },
        required: ["tool", "input"],
        additionalProperties: false,
      },
    },
  },
  required: ["assessment", "needsCompanyRecord", "toolCalls"],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You triage which companies in Hartwich Labs' sales CRM need a human reviewer's attention. You are told a company id and the reason it was surfaced — nothing else about the company itself. Never guess or invent anything about the actual business (its name, reviews, location, etc.) — you have no data on it yet. Your only job is to decide, from the reason alone, whether a human reviewer would benefit from the full CRM record being pulled up, and to request it via the get_company tool if so.`;

export const companyReviewAgent: AgentDefinition<CompanyReviewInput, CompanyReviewOutput> = {
  id: "company_review_agent",
  name: "Company Review Agent",
  version: "0.1.0",
  capabilities: ["qualification_review_triage"],
  tools: ["get_company"],
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  autonomyLevel: 0, // Level 0 — observe only. Its one tool is read-only, so this is enough to actually run.
  modelLane: "fast", // classification/routing-shaped — Groq, not Claude.
  buildPrompt(input) {
    return {
      system: SYSTEM_PROMPT,
      user: `Company id: ${input.companyId}\nReason surfaced for review: ${input.reason}\n\nDecide whether to request the full record.`,
      jsonSchema: JSON_SCHEMA,
    };
  },
};
