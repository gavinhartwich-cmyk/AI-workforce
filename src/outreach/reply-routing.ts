import type { ConversationClassification } from "../agents/conversation-intelligence-agent.js";

/**
 * The deterministic decision Conversation Intelligence's classification
 * feeds into (SPEC.md §17/§29: routine conversations handled
 * autonomously, unusual/high-impact escalate). Code, not the model,
 * decides which bucket a classification falls into — same split as
 * qualification scoring (src/qualification/scoring.ts).
 */
export type ReplyAction =
  | { action: "suppress" } // STOP_CONTACT — permanent, no reply sent
  | { action: "close_lost" } // a clear no or already-solved — closes the loop, no more follow-ups
  | { action: "autonomous_reply"; useAppointmentAgent: boolean } // routine — respond ourselves
  | { action: "escalate" } // PRICE/HOSTILE/low-confidence — a human decides, no autonomous reply
  | { action: "no_action" }; // e.g. an out-of-office auto-responder — nothing to do

const ESCALATE: ReadonlySet<ConversationClassification> = new Set(["PRICE", "HOSTILE"]);
const CLOSE_LOST: ReadonlySet<ConversationClassification> = new Set(["NOT_INTERESTED", "ALREADY_HAS_SOLUTION"]);

/** Below this, an UNKNOWN classification goes to a human rather than risking an autonomous reply to something the model itself wasn't sure about. */
const LOW_CONFIDENCE_THRESHOLD = 50;

export function decideReplyAction(
  classification: ConversationClassification,
  confidence: number,
  appointmentIntent: boolean
): ReplyAction {
  if (classification === "STOP_CONTACT") return { action: "suppress" };
  if (classification === "OUT_OF_OFFICE") return { action: "no_action" };
  if (ESCALATE.has(classification)) return { action: "escalate" };
  if (CLOSE_LOST.has(classification)) return { action: "close_lost" };
  if (classification === "UNKNOWN" && confidence < LOW_CONFIDENCE_THRESHOLD) return { action: "escalate" };

  // INTERESTED, QUESTION, OBJECTION, NOT_NOW, WRONG_PERSON, REFERRAL, and a
  // confident UNKNOWN all get a real, personal reply.
  return { action: "autonomous_reply", useAppointmentAgent: appointmentIntent };
}
