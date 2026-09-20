import { z } from "zod";
import type { AgentDefinition } from "../runtime/types.js";
import { AUTONOMY } from "../runtime/autonomy-levels.js";

/**
 * Prospect Discovery Agent (SPEC.md §23). The actual search and dedupe are
 * deterministic (src/tools/search-google-places.ts,
 * find-duplicate-company.ts) — code does those reliably, so the LLM isn't
 * asked to (SPEC.md §10: don't use an LLM for arithmetic/lookups plain
 * code handles). What a model *does* add here: raw Places text-search
 * results routinely include near-misses (a supply store, a home
 * inspector, a franchise on the exclusion list) that a keyword match alone
 * won't filter — this agent's only job is that screen, not lead quality
 * (that's Qualification's job, downstream).
 */

const CandidateSchema = z.object({
  placeId: z.string(),
  name: z.string(),
  address: z.string().nullable(),
  website: z.string().nullable(),
  rating: z.number().nullable(),
  userRatingCount: z.number().nullable(),
});

const InputSchema = z.object({
  area: z.string(),
  keyword: z.string(),
  candidates: z.array(CandidateSchema).min(1),
  /** Franchise/brand names or other ICP exclusions — data (lead_sources_config-shaped), never baked into the prompt. */
  exclusions: z.array(z.string()).default([]),
});

const DecisionSchema = z.object({
  placeId: z.string(),
  keep: z.boolean(),
  reason: z.string(),
});

const OutputSchema = z.object({ decisions: z.array(DecisionSchema) });

export type ProspectDiscoveryInput = z.infer<typeof InputSchema>;
export type ProspectDiscoveryOutput = z.infer<typeof OutputSchema>;

const JSON_SCHEMA = {
  type: "object",
  properties: {
    decisions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          placeId: { type: "string" },
          keep: { type: "boolean" },
          reason: { type: "string" },
        },
        required: ["placeId", "keep", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["decisions"],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You screen raw Google Places search results for Hartwich Labs' HVAC lead-discovery pipeline (Hartwich Labs sells Google review automation / reputation management to HVAC service businesses). For each candidate, decide only whether it plausibly IS the kind of business being searched for — a real, operating HVAC service business, not a supply store, parts retailer, unrelated business, or an obvious mismatch on the keyword. Do not judge lead quality, review count, or sales opportunity here — that happens in a separate step. If a candidate's name matches one of the given exclusions (a franchise/brand name), drop it. Return a decision for every candidate given, never fewer or more. Never invent anything about a candidate beyond its name/address/website — you have no other information about it.`;

export const prospectDiscoveryAgent: AgentDefinition<ProspectDiscoveryInput, ProspectDiscoveryOutput> = {
  id: "prospect_discovery_agent",
  name: "Prospect Discovery Agent",
  version: "0.1.0",
  capabilities: ["prospect_screening"],
  tools: [],
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  autonomyLevel: AUTONOMY.AUTONOMOUS_ROUTINE, // routine, per SPEC.md §17 — no per-batch approval
  modelLane: "fast", // classification-shaped
  buildPrompt(input) {
    return {
      system: SYSTEM_PROMPT,
      user: `Search: "${input.keyword}" in "${input.area}"\nExclusions: ${
        input.exclusions.length > 0 ? input.exclusions.join(", ") : "(none)"
      }\n\nCandidates:\n${JSON.stringify(input.candidates, null, 2)}`,
      jsonSchema: JSON_SCHEMA,
    };
  },
};
