import { z } from "zod";
import type { ToolDefinition } from "../runtime/types.js";
import { PostgresHartwichWriteStore, type HartwichWriteStore } from "../db/hartwich-os/write-store.js";

const InputSchema = z.object({
  companyId: z.string().uuid(),
  contactId: z.string().uuid().nullable(),
  dealId: z.string().uuid().nullable(),
  fromAddress: z.string(),
  subject: z.string(),
  body: z.string(),
  providerMessageId: z.string(),
  threadId: z.string(),
});

export function createRecordInboundReplyTool(
  store: HartwichWriteStore = new PostgresHartwichWriteStore()
): ToolDefinition<z.infer<typeof InputSchema>, { activityId: string; messageId: string }> {
  return {
    name: "record_inbound_reply",
    description: "Record a genuine inbound reply as a CRM activity/message and advance the deal to Engaged.",
    mutating: true,
    inputSchema: InputSchema,
    async execute(input) {
      return store.recordInboundReply(input);
    },
  };
}
