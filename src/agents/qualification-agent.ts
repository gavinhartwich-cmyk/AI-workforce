import { z } from "zod";
import type { AgentDefinition } from "../runtime/types.js";
import { AUTONOMY } from "../runtime/autonomy-levels.js";

/**
 * Qualification Agent (SPEC.md §25). Produces a 0-100 sub-assessment per
 * dimension, with reasoning grounded in what Research actually found — but
 * NOT a final score or tier. That's computed deterministically afterward
 * by src/qualification/scoring.ts, per SPEC.md §10/§25: "do not let the
 * LLM silently modify the scoring formula." The system prompt says this
 * outright so the model isn't confused about why it's not asked for a
 * bottom-line number.
 */

const InputSchema = z.object({
  place: z.object({
    name: z.string(),
    website: z.string().nullable(),
    rating: z.number().nullable(),
    userRatingCount: z.number().nullable(),
  }),
  research: z.object({
    summary: z.string(),
    servicesOffered: z.array(z.string()),
    apparentSize: z.string(),
    contactName: z.string().nullable(),
    contactEmail: z.string().nullable(),
    contactPhone: z.string().nullable(),
    salesSignals: z.array(z.object({ signal: z.string(), evidence: z.string() })),
  }),
});

const SubscoreSchema = z.object({
  value: z.number().min(0).max(100),
  reasoning: z.string(),
});

const OutputSchema = z.object({
  icpFit: SubscoreSchema,
  opportunity: SubscoreSchema,
  contactability: SubscoreSchema,
  businessQuality: SubscoreSchema,
  timing: SubscoreSchema,
  dataConfidence: SubscoreSchema,
});

export type QualificationInput = z.infer<typeof InputSchema>;
export type QualificationAgentOutput = z.infer<typeof OutputSchema>;

function subscoreSchemaJson() {
  return {
    type: "object",
    properties: { value: { type: "number" }, reasoning: { type: "string" } },
    required: ["value", "reasoning"],
    additionalProperties: false,
  };
}

const JSON_SCHEMA = {
  type: "object",
  properties: {
    icpFit: subscoreSchemaJson(),
    opportunity: subscoreSchemaJson(),
    contactability: subscoreSchemaJson(),
    businessQuality: subscoreSchemaJson(),
    timing: subscoreSchemaJson(),
    dataConfidence: subscoreSchemaJson(),
  },
  required: ["icpFit", "opportunity", "contactability", "businessQuality", "timing", "dataConfidence"],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You assess how well a researched prospect fits Hartwich Labs' HVAC ICP (Google review automation / reputation-management for HVAC service businesses). Score six dimensions, each 0-100, grounded ONLY in the research given — never guess beyond it:

- icpFit: is this a local HVAC service business of a size/type Hartwich Labs actually serves (not a supply store, not a huge national chain)?
- opportunity: how much would this business plausibly benefit from review automation — weak review volume, low rating, or other cited signal of reputation-infrastructure gaps?
- contactability: is there a real named contact with a working-looking email or phone, or only a generic inbox / nothing at all?
- businessQuality: does this look like a legitimate, active, going-concern business (a real website, real services listed, real address) rather than a defunct or barely-existing listing?
- timing: any cited evidence of active growth, recent activity, or other reason now might be a good time to reach out (absence of evidence is not itself negative — score around the middle when there's simply nothing to go on)?
- dataConfidence: how much of what you're scoring is solid, cited evidence versus thin or missing information?

You are NOT computing a final score or pass/fail tier — a fixed, human-set formula outside your control does that from your six numbers. Give your honest, independent assessment of each dimension with reasoning that cites the actual research provided.`;

export const qualificationAgent: AgentDefinition<QualificationInput, QualificationAgentOutput> = {
  id: "qualification_agent",
  name: "Qualification Agent",
  version: "0.1.0",
  capabilities: ["prospect_qualification"],
  tools: [],
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  autonomyLevel: AUTONOMY.AUTONOMOUS_ROUTINE,
  modelLane: "fast",
  buildPrompt(input) {
    return {
      system: SYSTEM_PROMPT,
      user: `Google Places data:\n${JSON.stringify(input.place, null, 2)}\n\nResearch:\n${JSON.stringify(
        input.research,
        null,
        2
      )}`,
      jsonSchema: JSON_SCHEMA,
    };
  },
};
