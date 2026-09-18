import { z } from "zod";
import type { AgentDefinition } from "../runtime/types.js";
import { AUTONOMY } from "../runtime/autonomy-levels.js";

/**
 * Research + Qualification in one call (SPEC.md §24 and §25), replacing the
 * two-agent chain that ran per candidate.
 *
 * The chain re-sent everything the second call needed: the qualification
 * prompt, the Places data again, and the entire research object serialised
 * back in as input — roughly 700-1000 tokens per candidate spent restating
 * what the model had just produced. On a rolling-24h token cap that the
 * agents were exhausting daily (2026-09-11), that restatement was the
 * cheapest thing to stop paying for.
 *
 * What did NOT move into the model: the scoring formula. This still emits
 * six 0-100 sub-assessments and nothing else — src/qualification/scoring.ts
 * turns them into a score, tier and status, per SPEC.md §10/§25's "do not
 * let the LLM silently modify the scoring formula."
 *
 * Order matters in the output schema. Structured generation fills fields in
 * declaration order, so research comes first and `assessment` last: the
 * model has to commit to what it found before it scores it, which preserves
 * the property the two-call chain got for free by construction.
 */

const InputSchema = z.object({
  place: z.object({
    name: z.string(),
    address: z.string().nullable(),
    phone: z.string().nullable(),
    website: z.string().nullable(),
    rating: z.number().nullable(),
    userRatingCount: z.number().nullable(),
  }),
  /** Stripped website text, or null if there's no website / the fetch failed. */
  websiteText: z.string().nullable(),
});

const SalesSignalSchema = z.object({
  signal: z.string(),
  /** What in the given data actually supports this — a review-count fact, a specific line from the site, etc. */
  evidence: z.string(),
});

const SubscoreSchema = z.object({
  value: z.number().min(0).max(100),
  reasoning: z.string(),
});

const AssessmentSchema = z.object({
  icpFit: SubscoreSchema,
  opportunity: SubscoreSchema,
  contactability: SubscoreSchema,
  businessQuality: SubscoreSchema,
  timing: SubscoreSchema,
  dataConfidence: SubscoreSchema,
});

const OutputSchema = z.object({
  servicesOffered: z.array(z.string()),
  apparentSize: z.enum(["solo", "small", "medium", "large", "unknown"]),
  contactName: z.string().nullable(),
  contactTitle: z.string().nullable(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  contactLinkedinUrl: z.string().nullable(),
  summary: z.string(),
  salesSignals: z.array(SalesSignalSchema),
  assessment: AssessmentSchema,
});

export type ProspectAssessmentInput = z.infer<typeof InputSchema>;
export type ProspectAssessmentOutput = z.infer<typeof OutputSchema>;

/** The research half, in the shape the persist path and outreach agents already expect. */
export type ResearchFacts = Omit<ProspectAssessmentOutput, "assessment">;

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
    servicesOffered: { type: "array", items: { type: "string" } },
    apparentSize: { type: "string", enum: ["solo", "small", "medium", "large", "unknown"] },
    contactName: { type: ["string", "null"] },
    contactTitle: { type: ["string", "null"] },
    contactEmail: { type: ["string", "null"] },
    contactPhone: { type: ["string", "null"] },
    contactLinkedinUrl: { type: ["string", "null"] },
    summary: { type: "string" },
    salesSignals: {
      type: "array",
      items: {
        type: "object",
        properties: { signal: { type: "string" }, evidence: { type: "string" } },
        required: ["signal", "evidence"],
        additionalProperties: false,
      },
    },
    assessment: {
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
    },
  },
  required: [
    "servicesOffered",
    "apparentSize",
    "contactName",
    "contactTitle",
    "contactEmail",
    "contactPhone",
    "contactLinkedinUrl",
    "summary",
    "salesSignals",
    "assessment",
  ],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You research and assess an HVAC business found via Google Places, for Hartwich Labs (Google review automation / reputation-management for HVAC service businesses). You are given the business's Google Places data and, if available, plain text scraped from its website — nothing else.

FIRST, research it. Extract services offered, apparent size, and the primary decision-maker (owner, manager) if named. Only report what is actually stated or clearly implied in what you were given — use null for any contact field not found, and "unknown" for apparentSize if you can't tell. Never guess or invent a name, email, or fact.

For salesSignals, identify real evidence of a reputation-management opportunity for Hartwich Labs specifically — e.g. a low review count, a sub-4-star rating, or something the website itself says that suggests the business cares about growth/reviews/customer acquisition. Every signal must name the actual evidence for it (a number, a quoted or paraphrased line from the site) — an empty list is correct if nothing supports a signal; never fabricate one to fill the list.

THEN, assess it. Score six dimensions 0-100, grounded ONLY in what you just found above — never in anything beyond the data you were given:

- icpFit: is this a local HVAC service business of a size/type Hartwich Labs actually serves (not a supply store, not a huge national chain)?
- opportunity: how much would this business plausibly benefit from review automation — weak review volume, low rating, or another cited signal of reputation-infrastructure gaps? A business already holding hundreds of reviews has largely solved this problem and scores LOW here, however good a business it is.
- contactability: is there a real named contact with a working-looking email or phone, or only a generic inbox / nothing at all?
- businessQuality: does this look like a legitimate, active, going-concern business (a real website, real services listed, real address) rather than a defunct or barely-existing listing?
- timing: any cited evidence of active growth, recent activity, or other reason now might be a good time to reach out (absence of evidence is not itself negative — score around the middle when there's simply nothing to go on)?
- dataConfidence: how much of what you're scoring is solid, cited evidence versus thin or missing information?

You are NOT computing a final score or pass/fail tier — a fixed, human-set formula outside your control does that from your six numbers. Give your honest, independent assessment of each dimension, with reasoning that cites what your own research above actually found.`;

export const prospectAssessmentAgent: AgentDefinition<ProspectAssessmentInput, ProspectAssessmentOutput> = {
  id: "prospect_assessment_agent",
  name: "Prospect Assessment Agent",
  version: "0.1.0",
  capabilities: ["prospect_research", "prospect_qualification"],
  tools: [],
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  autonomyLevel: AUTONOMY.AUTONOMOUS_ROUTINE,
  modelLane: "fast",
  // Research alone already needed 2048 (the provider's 1024 default was
  // truncating on real, larger sites and failing schema validation). This
  // carries the same fields plus six scored dimensions with reasoning, so
  // it needs more headroom again — a truncated response costs the whole
  // call and then gets retried, which is worse than a generous ceiling.
  maxOutputTokens: 3072,
  buildPrompt(input) {
    return {
      system: SYSTEM_PROMPT,
      user: `Google Places data:\n${JSON.stringify(input.place, null, 2)}\n\nWebsite text:\n${
        input.websiteText ?? "(no website, or the fetch failed — work from the Places data alone)"
      }`,
      jsonSchema: JSON_SCHEMA,
    };
  },
};
