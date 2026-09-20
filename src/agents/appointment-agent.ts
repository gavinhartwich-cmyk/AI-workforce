import { z } from "zod";
import type { AgentDefinition } from "../runtime/types.js";
import { AUTONOMY } from "../runtime/autonomy-levels.js";

/**
 * Appointment Agent (SPEC.md §31). "Never invent availability" is
 * structural here, not a prompt rule: the model is handed a real booking
 * link (src/outreach/booking-link.ts, pointing at hartwich-os's own
 * Google-Calendar-backed /book page) and asked only to write a short,
 * personal reply that offers it — it never sees or reasons about actual
 * calendar slots, so it has nothing to hallucinate about.
 */

const InputSchema = z.object({
  company: z.object({ name: z.string() }),
  contact: z.object({ name: z.string().nullable() }).nullable(),
  originalSubject: z.string(),
  replyText: z.string(),
  bookingLink: z.string(),
  yourName: z.string(),
  yourCompany: z.string(),
});

const OutputSchema = z.object({ subject: z.string(), body: z.string() });

export type AppointmentAgentInput = z.infer<typeof InputSchema>;
export type AppointmentAgentOutput = z.infer<typeof OutputSchema>;

const JSON_SCHEMA = {
  type: "object",
  properties: { subject: { type: "string" }, body: { type: "string" } },
  required: ["subject", "body"],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `A prospect replied to a cold outreach email expressing interest in booking a call with Hartwich Labs. Write a short, warm, personal reply that offers the booking link given to you — never invent times, availability, or a calendar of your own; the link is the only way to actually book, and it's real. Reference what they actually said if it's natural to. Keep it brief — this is a "great, here's the link" message, not a new pitch. Subject: reuse "Re: " + the original subject. Keep punctuation plain.`;

export const appointmentAgent: AgentDefinition<AppointmentAgentInput, AppointmentAgentOutput> = {
  id: "appointment_agent",
  name: "Appointment Agent",
  version: "0.1.0",
  capabilities: ["appointment_booking"],
  tools: [],
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  autonomyLevel: AUTONOMY.AUTONOMOUS_ROUTINE,
  modelLane: "fast",
  buildPrompt(input) {
    const contactLine = input.contact?.name ? `Contact: ${input.contact.name}` : "Contact: no named contact known.";
    return {
      system: SYSTEM_PROMPT,
      user: `Company: ${input.company.name}
${contactLine}
Your name: ${input.yourName}
Your company: ${input.yourCompany}
Original subject: ${input.originalSubject}
Booking link (use this exact URL): ${input.bookingLink}

What they replied with:
"""
${input.replyText}
"""`,
      jsonSchema: JSON_SCHEMA,
    };
  },
};
