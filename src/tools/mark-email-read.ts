import { z } from "zod";
import type { ToolDefinition } from "../runtime/types.js";
import { GoogleGmailReader, type GmailReader } from "../integrations/gmail.js";

const InputSchema = z.object({
  accountIndex: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  gmailMessageId: z.string(),
});

/** Called once a message's handling is decided, whatever the outcome — never reprocess the same reply on the next poll. */
export function createMarkEmailReadTool(
  reader: GmailReader = new GoogleGmailReader()
): ToolDefinition<z.infer<typeof InputSchema>, { ok: true }> {
  return {
    name: "mark_email_read",
    description: "Remove the UNREAD label from a Gmail message.",
    mutating: true,
    inputSchema: InputSchema,
    async execute(input) {
      await reader.markRead(input.accountIndex, input.gmailMessageId);
      return { ok: true };
    },
  };
}
