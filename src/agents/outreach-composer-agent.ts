import { z } from "zod";
import type { AgentDefinition } from "../runtime/types.js";
import { AUTONOMY } from "../runtime/autonomy-levels.js";
import { APPROVED_MESSAGING_CONFIG } from "../outreach/approved-messaging-config.js";

/**
 * Outreach strategy + copy in one call (SPEC.md §26 and §27), replacing the
 * two-agent chain that ran per outreach target.
 *
 * outreach_strategy_agent was the highest-volume agent in the system — 228
 * runs in 24h on 2026-09-11, more than any other — and every one of them was
 * followed by a generation call that re-sent the company, the contact and
 * the whole strategy object back in as input. Same waste as the research ->
 * qualification chain: paying to restate what the model had just produced.
 *
 * The strategy is STILL emitted, not folded away. Its original purpose
 * (SPEC.md §26) was to make the strategic choice explicit and structured so
 * an experiment can test one choice — the angle, say — without touching how
 * messages are worded. That only works if the choice stays inspectable, so
 * `strategy` remains a first-class part of the output and experiment
 * directives remain a first-class input constraint.
 *
 * Declaration order does the work the two calls used to: `strategy` is
 * declared before `initial` and `followUps`, and structured generation fills
 * fields in order, so the model commits to an angle before it writes to it.
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
  contact: z.object({ name: z.string().nullable(), title: z.string().nullable() }).nullable(),
  qualificationReasoning: z.string().nullable(),
  enabledChannels: z.array(z.string()).min(1),
  /** If an active experiment assigned this prospect a variant, its directive — the agent must align with it, not override it. */
  experimentDirective: z.string().nullable(),
  yourName: z.string(),
  yourCompany: z.string(),
});

const StrategySchema = z.object({
  channel: z.string(),
  angle: z.string(),
  hook: z.string(),
  personalizationPoints: z.array(z.string()),
  cta: z.string(),
  reasoning: z.string(),
});

const MessageSchema = z.object({ subject: z.string(), body: z.string() });

const OutputSchema = z.object({
  strategy: StrategySchema,
  initial: MessageSchema,
  followUps: z.array(MessageSchema.extend({ followUpNumber: z.number().int().min(1) })),
});

export type OutreachComposerInput = z.infer<typeof InputSchema>;
export type OutreachComposerOutput = z.infer<typeof OutputSchema>;

function messageSchemaJson(extra: Record<string, unknown> = {}, required: string[] = []) {
  return {
    type: "object",
    properties: { subject: { type: "string" }, body: { type: "string" }, ...extra },
    required: ["subject", "body", ...required],
    additionalProperties: false,
  };
}

const JSON_SCHEMA = {
  type: "object",
  properties: {
    strategy: {
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
    },
    initial: messageSchemaJson(),
    followUps: {
      type: "array",
      items: messageSchemaJson({ followUpNumber: { type: "number" } }, ["followUpNumber"]),
    },
  },
  required: ["strategy", "initial", "followUps"],
  additionalProperties: false,
};

function buildSystemPrompt(): string {
  const c = APPROVED_MESSAGING_CONFIG;
  return `You are ${"{{yourName}}"}, writing outreach for ${"{{yourCompany}}"}. ${c.offer}

Positioning: ${c.positioning}

Work in two steps, in this order.

STEP 1 — decide the strategy for this one prospect:
- channel: pick one from the enabled channels given — never propose a channel that isn't enabled.
- angle: the specific reason THIS business, from what's actually known about it, is a good fit for the offer (a review-count gap, a rating gap, something its website says).
- hook: the one concrete opening observation the message should lead with — traceable to the research given, never invented.
- personalizationPoints: 1-3 other specific facts from the research worth weaving in.
- cta: the single call to action (never more than one ask).
- reasoning: briefly why this strategy fits this prospect.

If no contact name is known, don't build a strategy that assumes one. If an experiment directive is given, your angle and hook must align with it — it is not a suggestion, it is the constraint you're being tested against. Never invent a fact about the business beyond what you were given.

STEP 2 — write the copy, following the strategy you just chose. Hard rules, never violate any:
${c.hardRules.map((r) => `- ${r}`).join("\n")}

- Initial message: ${c.wordCountRange.min}-${c.wordCountRange.max} words, at most ${c.cta.maxCtasPerMessage} call-to-action — use your strategy's CTA (prefer "${c.cta.preferredCta}" only as a fallback style).
- Then up to ${c.maxFollowUps} follow-ups, numbered 1..${c.maxFollowUps}: SHORT (40-80 words) — a bump, not a re-pitch. Reference that it's a follow-up naturally. The last one may softly close the loop.
- Subject lines: short and specific, not a complete-sentence summary of the pitch.
- Use the angle, hook and personalization points you chose above — don't drift to different ones.
- If no contact name is known, greet generically ("Hi there," or similar) — never invent a name or address by a job title as if it were one.
- End every message (initial and every follow-up) with a brief sign-off on its own line(s): a closing word, then ${"{{yourName}}"}, then ${"{{yourCompany}}"} — e.g. "Best,\n${"{{yourName}}"}\n${"{{yourCompany}}"}". Never send a message with no signature — an unsigned cold email reads as spam, not a real person.
- Keep punctuation plain — avoid leaning on em dashes.`;
}

export const outreachComposerAgent: AgentDefinition<OutreachComposerInput, OutreachComposerOutput> = {
  id: "outreach_composer_agent",
  name: "Outreach Composer Agent",
  version: "0.1.0",
  capabilities: ["outreach_strategy", "outreach_generation"],
  tools: [],
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  autonomyLevel: AUTONOMY.AUTONOMOUS_ROUTINE,
  modelLane: "fast",
  // An initial message (80-160 words) plus three 40-80 word follow-ups is
  // already ~900-1100 output tokens before the strategy block — against the
  // provider's 1024 default, which generation alone was running into. A
  // truncated response fails schema validation and costs the entire call,
  // so the ceiling is set well clear of the worst case rather than close to
  // the average one.
  maxOutputTokens: 2560,
  buildPrompt(input) {
    const system = buildSystemPrompt()
      .replaceAll("{{yourName}}", input.yourName)
      .replaceAll("{{yourCompany}}", input.yourCompany);

    const contactLine = input.contact?.name
      ? `Contact: ${input.contact.name}${input.contact.title ? `, ${input.contact.title}` : ""}`
      : "Contact: no named contact known — greet generically.";

    return {
      system,
      user: `Company:\n${JSON.stringify(input.company, null, 2)}

${contactLine}
Your name: ${input.yourName}
Your company: ${input.yourCompany}
Qualification reasoning: ${input.qualificationReasoning ?? "(none)"}
Enabled channels: ${input.enabledChannels.join(", ")}${
        input.experimentDirective ? `\n\nExperiment directive (must follow): ${input.experimentDirective}` : ""
      }`,
      jsonSchema: JSON_SCHEMA,
    };
  },
};
