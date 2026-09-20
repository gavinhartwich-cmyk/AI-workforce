import { z } from "zod";
import type { ToolDefinition } from "../runtime/types.js";
import { GoogleGmailSender, type GmailSender } from "../integrations/gmail.js";

const InputSchema = z.object({
  accountIndex: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  to: z.string().email(),
  subject: z.string().min(1),
  body: z.string().min(1),
  // Set all three (Phase 6) to send in-thread as a reply — never set for a first-touch cold email or a follow-up.
  inReplyTo: z.string().optional(),
  references: z.string().optional(),
  threadId: z.string().optional(),
});

/**
 * The one tool in this repo that reaches an actual prospect. Real
 * autonomous sending — SPEC.md §20/§28: routine outbound doesn't wait for
 * a human once it clears every check upstream (opt-out, kill switch,
 * duplicate-contact, sending window, warm-up rate limit — see
 * src/pipelines/execute-outreach.ts). Nothing about this tool itself
 * enforces those checks; it's the last, dumbest step on purpose, so every
 * safeguard lives in one place upstream, not duplicated here.
 */
export function createSendEmailTool(
  sender: GmailSender = new GoogleGmailSender()
): ToolDefinition<z.infer<typeof InputSchema>, { messageId: string; fromAddress: string; threadId: string | null }> {
  return {
    name: "send_email",
    description: "Send an email via one of the rotating Gmail accounts.",
    mutating: true,
    inputSchema: InputSchema,
    async execute(input) {
      return sender.send(input);
    },
  };
}
