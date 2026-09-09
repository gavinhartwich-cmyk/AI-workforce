import { z } from "zod";
import type { ToolDefinition } from "../runtime/types.js";
import { GoogleGmailSender, type GmailSender } from "../integrations/gmail.js";

const InputSchema = z.object({ subject: z.string(), body: z.string() });

/**
 * Human escalation (SPEC.md §37) — sent from account 0, mirroring
 * hartwich-os's own notifyOps: an internal alert, not outreach, so it
 * bypasses the send-guard entirely (no opt-out/warm-up/window checks
 * apply to an email to Gavin himself). Used for PRICE negotiation, HOSTILE
 * replies, and anything else Conversation Intelligence decides needs a
 * human, not an autonomous response (SPEC.md §17's human-confirmation
 * list: unusual negotiations, major complaints).
 */
export function createNotifyGavinTool(
  sender: GmailSender = new GoogleGmailSender()
): ToolDefinition<z.infer<typeof InputSchema>, { ok: true }> {
  return {
    name: "notify_gavin",
    description: "Send Gavin an internal alert email about something that needs his attention.",
    mutating: true,
    inputSchema: InputSchema,
    async execute(input) {
      const gavinEmail = process.env.GAVIN_EMAIL;
      if (!gavinEmail) throw new Error("GAVIN_EMAIL is not set — required to send escalation alerts.");
      await sender.send({ accountIndex: 0, to: gavinEmail, subject: `[Hartwich AI] ${input.subject}`, body: input.body });
      return { ok: true };
    },
  };
}
