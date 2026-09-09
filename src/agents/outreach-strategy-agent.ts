import { z } from "zod";
import type { AgentDefinition } from "../runtime/types.js";
import { AUTONOMY } from "../runtime/autonomy-levels.js";

/**
 * Outreach Strategy Agent (SPEC.md §26): decides channel, angle, hook,
 * personalization points, and CTA for one qualified prospect — before any
 * message is drafted. Separating this from Generation (SPEC.md §27) is
 * new versus hartwich-os's own draft-outreach.ts, which bakes strategy and
 * copy into a single prompt; making the decision explicit and structured
 * is what lets an experiment (src/experiments/*) test one strategic
 * choice (e.g. the angle) without touching how messages are worded.
 */

const InputSchema = z.object({
  company: z.object({
    name: z.string(),
    website: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
    googleReviewCount: z.number().nullable(),
    googleRating: z.number().nullable(),
    websiteSummary: z.string().nullable(),
    servicesOffered: z.array(z.string()).nullable(),
    apparentSize: z.string().nullable(),
  }),
  contactKnown: z.boolean(), // whether Research found a named contact — affects hook/personalization options
  qualificationReasoning: z.string().nullable(),
  enabledChannels: z.array(z.string()).min(1),
  /** If an active experiment assigned this prospect a variant, its directive — the agent must align with it, not override it. */
  experimentDirective: z.string().nullable(),
});

const OutputSchema = z.object({
  channel: z.string(),
  angle: z.string(),
  hook: z.string(),
  personalizationPoints: z.array(z.string()),
  cta: z.string(),
  reasoning: z.string(),
});

export type OutreachStrategyInput = z.infer<typeof InputSchema>;
export type OutreachStrategyOutput = z.infer<typeof OutputSchema>;

const JSON_SCHEMA = {
  type: "object",
  properties: {
    channel: { type: "string" },
    angle: { type: "string" },
    hook: { type: "string" },
    personalizationPoints: { type: "array", items: { type: "string" } },
    cta: { type: "string" },
    reasoning: { type: "string" },
  },
  required: ["channel", "angle", "hook", "personalizationPoints", "cta", "reasoning"],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You decide the outreach STRATEGY for one qualified HVAC prospect of Hartwich Labs (Google review automation / reputation management) — not the message copy itself, a separate step handles that.

Choose:
- channel: pick one from the enabled channels given — never propose a channel that isn't enabled.
- angle: the specific reason THIS business, from what's actually known about it, is a good fit for the offer (e.g. a review-count gap, a rating gap, a specific thing its website says).
- hook: the one concrete, specific opening observation the message should lead with — must be traceable to the research given, never invented.
- personalizationPoints: 1-3 other specific facts from the research worth weaving in.
- cta: the single call to action (never propose more than one ask).
- reasoning: briefly why this strategy fits this prospect.

If a contact name is NOT known, don't build a strategy that assumes one (no personalization point should imply addressing them by name). If an experiment directive is given, your angle and hook must align with it — it is not a suggestion, it is the constraint you're being tested against. Never invent a fact about the business beyond what's in the research provided.`;

export const outreachStrategyAgent: AgentDefinition<OutreachStrategyInput, OutreachStrategyOutput> = {
  id: "outreach_strategy_agent",
  name: "Outreach Strategy Agent",
  version: "0.1.0",
  capabilities: ["outreach_strategy"],
  tools: [],
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  autonomyLevel: AUTONOMY.AUTONOMOUS_ROUTINE,
  modelLane: "fast",
  buildPrompt(input) {
    return {
      system: SYSTEM_PROMPT,
      user: `Company:\n${JSON.stringify(input.company, null, 2)}\n\nNamed contact known: ${
        input.contactKnown
      }\nQualification reasoning: ${input.qualificationReasoning ?? "(none)"}\nEnabled channels: ${input.enabledChannels.join(
        ", "
      )}${input.experimentDirective ? `\n\nExperiment directive (must follow): ${input.experimentDirective}` : ""}`,
      jsonSchema: JSON_SCHEMA,
    };
  },
};
