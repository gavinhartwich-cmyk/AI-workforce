import { z } from "zod";
import type { AgentDefinition } from "../runtime/types.js";
import { AUTONOMY } from "../runtime/autonomy-levels.js";
import { APPROVED_MESSAGING_CONFIG } from "../outreach/approved-messaging-config.js";

/**
 * Outreach Generation Agent (SPEC.md §27): turns a Strategy decision into
 * actual copy — the initial message plus up to `maxFollowUps` short
 * bump-ups, generated together so the follow-ups can reference the
 * original without a second round-trip. Every hard rule from
 * src/outreach/approved-messaging-config.ts is interpolated into the
 * system prompt rather than re-typed here, so tightening a rule is a
 * config edit, not a prompt-hunting exercise across agents.
 */

const InputSchema = z.object({
  company: z.object({ name: z.string(), website: z.string().nullable() }),
  contact: z.object({ name: z.string().nullable(), title: z.string().nullable() }).nullable(),
  strategy: z.object({
    angle: z.string(),
    hook: z.string(),
    personalizationPoints: z.array(z.string()),
    cta: z.string(),
  }),
  yourName: z.string(),
  yourCompany: z.string(),
});

const MessageSchema = z.object({ subject: z.string(), body: z.string() });

const OutputSchema = z.object({
  initial: MessageSchema,
  followUps: z.array(MessageSchema.extend({ followUpNumber: z.number().int().min(1) })),
});

export type OutreachGenerationInput = z.infer<typeof InputSchema>;
export type OutreachGenerationOutput = z.infer<typeof OutputSchema>;

function messageSchemaJson() {
  return {
    type: "object",
    properties: { subject: { type: "string" }, body: { type: "string" } },
    required: ["subject", "body"],
    additionalProperties: false,
  };
}

const JSON_SCHEMA = {
  type: "object",
  properties: {
    initial: messageSchemaJson(),
    followUps: {
      type: "array",
      items: {
        type: "object",
        properties: { subject: { type: "string" }, body: { type: "string" }, followUpNumber: { type: "number" } },
        required: ["subject", "body", "followUpNumber"],
        additionalProperties: false,
      },
    },
  },
  required: ["initial", "followUps"],
  additionalProperties: false,
};

function buildSystemPrompt(): string {
  const c = APPROVED_MESSAGING_CONFIG;
  return `You are ${"{{yourName}}"}, writing outreach for ${"{{yourCompany}}"}. ${c.offer}

Positioning: ${c.positioning}

Hard rules — never violate any of these:
${c.hardRules.map((r) => `- ${r}`).join("\n")}

Write the initial message plus up to ${c.maxFollowUps} short follow-ups (numbered 1..${c.maxFollowUps}):
- Initial message: ${c.wordCountRange.min}-${c.wordCountRange.max} words, at most ${c.cta.maxCtasPerMessage} call-to-action (prefer "${c.cta.preferredCta}" unless the given strategy's CTA says otherwise — use the strategy's CTA, this is just the fallback style).
- Each follow-up: SHORT (40-80 words) — a bump, not a re-pitch. Reference that it's a follow-up naturally. The last one may softly close the loop.
- Subject lines: short and specific, not a complete-sentence summary of the pitch.
- Follow the given strategy exactly: use its angle, hook, and personalization points — don't invent your own.
- If no contact name is known, greet generically ("Hi there," or similar) — never invent a name or address by a job title as if it were one.
- End every message (initial and every follow-up) with a brief sign-off on its own line(s): a closing word, then ${"{{yourName}}"}, then ${"{{yourCompany}}"} — e.g. "Best,\n${"{{yourName}}"}\n${"{{yourCompany}}"}". Never send a message with no signature — an unsigned cold email reads as spam, not a real person.
- Keep punctuation plain — avoid leaning on em dashes.`;
}

export const outreachGenerationAgent: AgentDefinition<OutreachGenerationInput, OutreachGenerationOutput> = {
  id: "outreach_generation_agent",
  name: "Outreach Generation Agent",
  version: "0.1.0",
  capabilities: ["outreach_generation"],
  tools: [],
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  autonomyLevel: AUTONOMY.AUTONOMOUS_ROUTINE,
  modelLane: "fast",
  buildPrompt(input) {
    const system = buildSystemPrompt().replaceAll("{{yourName}}", input.yourName).replaceAll("{{yourCompany}}", input.yourCompany);
    const contactLine = input.contact?.name
      ? `Contact: ${input.contact.name}${input.contact.title ? `, ${input.contact.title}` : ""}`
      : "Contact: no named contact known — greet generically.";

    return {
      system,
      user: `Target company: ${input.company.name}${input.company.website ? ` (${input.company.website})` : ""}
${contactLine}
Your name: ${input.yourName}
Your company: ${input.yourCompany}

Strategy to follow:
- Angle: ${input.strategy.angle}
- Hook: ${input.strategy.hook}
- Personalization points: ${input.strategy.personalizationPoints.join("; ") || "(none given)"}
- CTA: ${input.strategy.cta}`,
      jsonSchema: JSON_SCHEMA,
    };
  },
};
