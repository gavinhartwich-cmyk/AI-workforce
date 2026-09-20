import { z } from "zod";
import type { AgentDefinition } from "../runtime/types.js";
import { AUTONOMY } from "../runtime/autonomy-levels.js";

/**
 * Conversation Intelligence Agent (SPEC.md §29). Classifies one inbound
 * reply and extracts signals — it does NOT decide what happens next.
 * Same split as prospect assessment (src/agents/prospect-assessment-agent.ts): the
 * model reports what it observes, deterministic code
 * (src/outreach/reply-routing.ts) decides the action from that. That
 * split is what keeps "which replies get an autonomous response vs. go to
 * Gavin" an auditable, config-driven decision instead of a model's
 * unreviewable judgment call.
 *
 * The classification named `STOP_CONTACT` here is SPEC.md §29's
 * `UNSUBSCRIBE` category, renamed (Gavin, 2026-09-XX): these are personal
 * 1:1 outreach emails, not a mailing list — there is no unsubscribe
 * mechanism to trigger, and this repo never adds one to outreach copy.
 * What's real is simpler: if a person says "stop emailing me," that's
 * respected — permanently, via the same opt-out list Phase 5 built — same
 * outcome as an "unsubscribe," just not framed or built like bulk-email
 * compliance.
 */

const InputSchema = z.object({
  company: z.object({ name: z.string() }),
  originalSubject: z.string(),
  replyText: z.string(),
});

const ClassificationEnum = z.enum([
  "INTERESTED",
  "QUESTION",
  "OBJECTION",
  "PRICE",
  "NOT_INTERESTED",
  "NOT_NOW",
  "ALREADY_HAS_SOLUTION",
  "WRONG_PERSON",
  "REFERRAL",
  "STOP_CONTACT",
  "HOSTILE",
  "OUT_OF_OFFICE",
  "UNKNOWN",
]);

const OutputSchema = z.object({
  classification: ClassificationEnum,
  buyingIntent: z.number().min(0).max(100),
  objections: z.array(z.string()),
  requestedInfo: z.array(z.string()),
  requestedFollowUpDate: z.string().nullable(),
  isDecisionMaker: z.enum(["yes", "no", "unknown"]),
  appointmentIntent: z.boolean(),
  sentiment: z.enum(["positive", "neutral", "negative"]),
  confidence: z.number().min(0).max(100),
  summary: z.string(),
});

export type ConversationClassification = z.infer<typeof ClassificationEnum>;
export type ConversationIntelligenceInput = z.infer<typeof InputSchema>;
export type ConversationIntelligenceOutput = z.infer<typeof OutputSchema>;

const JSON_SCHEMA = {
  type: "object",
  properties: {
    classification: { type: "string", enum: ClassificationEnum.options },
    buyingIntent: { type: "number" },
    objections: { type: "array", items: { type: "string" } },
    requestedInfo: { type: "array", items: { type: "string" } },
    requestedFollowUpDate: { type: ["string", "null"] },
    isDecisionMaker: { type: "string", enum: ["yes", "no", "unknown"] },
    appointmentIntent: { type: "boolean" },
    sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
    confidence: { type: "number" },
    summary: { type: "string" },
  },
  required: [
    "classification",
    "buyingIntent",
    "objections",
    "requestedInfo",
    "requestedFollowUpDate",
    "isDecisionMaker",
    "appointmentIntent",
    "sentiment",
    "confidence",
    "summary",
  ],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You read one reply to a personal cold-outreach email from Hartwich Labs (Google review automation / reputation management for HVAC businesses) and classify it. This is a real one-to-one email conversation, not a mailing list — read it the way you'd read a reply to an email a specific person sent another specific person.

Classify into exactly one category:
- INTERESTED: wants to know more or engage further.
- QUESTION: asked something specific that needs an answer before they'll engage.
- OBJECTION: raised a concern/pushback but hasn't said no outright.
- PRICE: asking about cost or negotiating — this always needs a human, never answer pricing yourself.
- NOT_INTERESTED: a clear no.
- NOT_NOW: interested in principle but bad timing.
- ALREADY_HAS_SOLUTION: already using a competitor or in-house process.
- WRONG_PERSON: says this isn't their area / wrong contact.
- REFERRAL: pointed you to someone else at the business.
- STOP_CONTACT: explicitly asked to stop being contacted (any phrasing — "unsubscribe," "stop emailing me," "remove me," "please don't contact again," etc.). Treat this exactly as seriously as a formal opt-out even though it's a personal email, not a list.
- HOSTILE: angry, offended, or aggressive — always needs a human, never reply yourself.
- OUT_OF_OFFICE: an automated absence reply, not a real response from the person.
- UNKNOWN: doesn't fit cleanly, or you're not confident.

Also extract: buyingIntent (0-100), any objections raised, any information they asked for, a requested follow-up date/timeframe if they gave one, whether they read as the actual decision-maker, whether they expressed appointment/call intent, overall sentiment, your confidence in this classification (0-100), and a one-sentence summary. Never guess beyond what the reply actually says.`;

export const conversationIntelligenceAgent: AgentDefinition<ConversationIntelligenceInput, ConversationIntelligenceOutput> = {
  id: "conversation_intelligence_agent",
  name: "Conversation Intelligence Agent",
  version: "0.1.0",
  capabilities: ["reply_classification"],
  tools: [],
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  autonomyLevel: AUTONOMY.AUTONOMOUS_ROUTINE,
  modelLane: "fast",
  buildPrompt(input) {
    return {
      system: SYSTEM_PROMPT,
      user: `Company: ${input.company.name}\nOriginal subject: ${input.originalSubject}\n\nTheir reply:\n"""\n${input.replyText}\n"""`,
      jsonSchema: JSON_SCHEMA,
    };
  },
};
