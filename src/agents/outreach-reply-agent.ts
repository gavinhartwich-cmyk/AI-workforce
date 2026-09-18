import { z } from "zod";
import type { AgentDefinition } from "../runtime/types.js";
import { AUTONOMY } from "../runtime/autonomy-levels.js";
import { APPROVED_MESSAGING_CONFIG } from "../outreach/approved-messaging-config.js";

/**
 * Answers a routine reply (SPEC.md §27's "objection responses," §29's
 * routine-conversation autonomy). The bar (Gavin, 2026-09-XX): this
 * should never read as an AI answering a support ticket — it reads like a
 * specific person read what they wrote and answered THAT, the same way
 * hartwich-os's own draftReplyEmail is built ("read what they actually
 * wrote and respond to it directly... without ignoring what they said in
 * favor of a generic pitch continuation").
 */

const InputSchema = z.object({
  company: z.object({ name: z.string(), website: z.string().nullable() }),
  contact: z.object({ name: z.string().nullable(), title: z.string().nullable() }).nullable(),
  originalSubject: z.string(),
  replyText: z.string(),
  yourName: z.string(),
  yourCompany: z.string(),
});

const OutputSchema = z.object({ subject: z.string(), body: z.string() });

export type OutreachReplyInput = z.infer<typeof InputSchema>;
export type OutreachReplyOutput = z.infer<typeof OutputSchema>;

const JSON_SCHEMA = {
  type: "object",
  properties: { subject: { type: "string" }, body: { type: "string" } },
  required: ["subject", "body"],
  additionalProperties: false,
};

function buildSystemPrompt(): string {
  const c = APPROVED_MESSAGING_CONFIG;
  return `You are replying to a prospect who just responded to your cold email about Hartwich Labs (${c.offer}). Read what they actually wrote and respond to THAT — answer any question, address any objection, acknowledge what they said — never ignore it in favor of a generic pitch continuation. This is a real one-to-one conversation; it should read like the specific person who sent the first email is now writing back, not like a company answering a support ticket.

Hard rules — never violate any of these:
${c.hardRules.map((r) => `- ${r}`).join("\n")}

If they asked something you don't have real information to answer accurately, say you'll follow up on specifics rather than guessing. If they raised an objection, address it honestly and briefly — don't oversell. Match their tone and length: brief if they were brief, more detailed if they wrote more. Subject: reuse "Re: " + the original subject. Keep punctuation plain, no em-dash crutch.

End the message with a brief sign-off on its own line(s) — a closing word, then your name and company (given below). Never send a message with no signature — an unsigned reply reads as spam, not a real person.`;
}

export const outreachReplyAgent: AgentDefinition<OutreachReplyInput, OutreachReplyOutput> = {
  id: "outreach_reply_agent",
  name: "Outreach Reply Agent",
  version: "0.1.0",
  capabilities: ["outreach_reply"],
  tools: [],
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  autonomyLevel: AUTONOMY.AUTONOMOUS_ROUTINE,
  modelLane: "fast",
  buildPrompt(input) {
    const contactLine = input.contact?.name
      ? `Contact: ${input.contact.name}${input.contact.title ? `, ${input.contact.title}` : ""}`
      : "Contact: no named contact known.";

    return {
      system: buildSystemPrompt(),
      user: `Company: ${input.company.name}${input.company.website ? ` (${input.company.website})` : ""}
${contactLine}
Your name: ${input.yourName}
Your company: ${input.yourCompany}
Original subject: ${input.originalSubject}

What they replied with:
"""
${input.replyText}
"""`,
      jsonSchema: JSON_SCHEMA,
    };
  },
};
