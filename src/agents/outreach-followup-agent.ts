import { z } from "zod";
import type { AgentDefinition } from "../runtime/types.js";
import { AUTONOMY } from "../runtime/autonomy-levels.js";
import { APPROVED_MESSAGING_CONFIG } from "../outreach/approved-messaging-config.js";

/**
 * Generates ONE follow-up at the time it's actually due (SPEC.md §30),
 * rather than pre-generating all of them upfront (Phase 4's Outreach
 * Generation Agent DOES produce follow-up copy alongside the initial
 * message, but that's written before there's a real sent message to bump
 * — see strategize-and-draft-outreach.ts's comment on why only the
 * initial gets persisted). Mirrors hartwich-os's own draftFollowUpEmail
 * prompt style (hartwich-os/src/lib/ai/draft-outreach.ts), minus its
 * open-tracking dependency, which this repo doesn't have yet.
 */

const InputSchema = z.object({
  company: z.object({ name: z.string(), website: z.string().nullable() }),
  contact: z.object({ name: z.string().nullable(), title: z.string().nullable() }).nullable(),
  originalSubject: z.string(),
  originalBody: z.string(),
  followUpNumber: z.number().int().min(1),
  yourName: z.string(),
  yourCompany: z.string(),
});

const OutputSchema = z.object({ subject: z.string(), body: z.string() });

export type OutreachFollowUpInput = z.infer<typeof InputSchema>;
export type OutreachFollowUpOutput = z.infer<typeof OutputSchema>;

const JSON_SCHEMA = {
  type: "object",
  properties: { subject: { type: "string" }, body: { type: "string" } },
  required: ["subject", "body"],
  additionalProperties: false,
};

function buildSystemPrompt(): string {
  const c = APPROVED_MESSAGING_CONFIG;
  return `You are writing a brief follow-up to a cold email sent a few days ago that got no reply. ${c.offer}

Hard rules — never violate any of these:
${c.hardRules.map((r) => `- ${r}`).join("\n")}

This is follow-up #1, #2, or #3 in a short sequence, up to ${c.maxFollowUps} total — you'll be told which. Keep it SHORT (40-80 words) — a bump, not a re-pitch. Reference that it's a follow-up naturally, without sounding apologetic or pushy. On the last follow-up (#${c.maxFollowUps}), it's fine to softly close the loop. Subject: reuse the original prefixed with "Re: " unless a short, natural variant reads better. Keep punctuation plain.

End the message with a brief sign-off on its own line(s) — a closing word, then your name and company (given below). Never send a message with no signature — an unsigned follow-up reads as spam, not a real person.`;
}

export const outreachFollowUpAgent: AgentDefinition<OutreachFollowUpInput, OutreachFollowUpOutput> = {
  id: "outreach_followup_agent",
  name: "Outreach Follow-Up Agent",
  version: "0.1.0",
  capabilities: ["outreach_followup"],
  tools: [],
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  autonomyLevel: AUTONOMY.AUTONOMOUS_ROUTINE,
  modelLane: "fast",
  buildPrompt(input) {
    const contactLine = input.contact?.name
      ? `Contact: ${input.contact.name}${input.contact.title ? `, ${input.contact.title}` : ""}`
      : "Contact: no named contact known — greet generically.";

    return {
      system: buildSystemPrompt(),
      user: `Target company: ${input.company.name}${input.company.website ? ` (${input.company.website})` : ""}
${contactLine}
Your name: ${input.yourName}
Your company: ${input.yourCompany}
This is follow-up #${input.followUpNumber}.

The original email sent:
Subject: ${input.originalSubject}
${input.originalBody}`,
      jsonSchema: JSON_SCHEMA,
    };
  },
};
