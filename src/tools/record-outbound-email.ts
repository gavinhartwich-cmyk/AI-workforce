import { z } from "zod";
import type { ToolDefinition } from "../runtime/types.js";
import { PostgresHartwichWriteStore, type HartwichWriteStore } from "../db/hartwich-os/write-store.js";

const InputSchema = z.object({
  companyId: z.string().uuid(),
  contactId: z.string().uuid().nullable(),
  dealId: z.string().uuid(),
  kind: z.enum(["cold_outreach", "follow_up"]),
  accountIndex: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  to: z.string().email(),
  fromAddress: z.string().email(),
  subject: z.string(),
  body: z.string(),
  providerMessageId: z.string(),
  threadId: z.string().nullable(),
});

/**
 * Records a completed send as a real hartwich-os activity/message and
 * advances the deal — see write-store.ts's recordOutboundEmail. Mutating,
 * but only ever called after send_email has already succeeded (it's
 * bookkeeping for something that already happened, not a second chance to
 * decide whether it should).
 */
export function createRecordOutboundEmailTool(
  store: HartwichWriteStore = new PostgresHartwichWriteStore()
): ToolDefinition<z.infer<typeof InputSchema>, { activityId: string; messageId: string }> {
  return {
    name: "record_outbound_email",
    description: "Record a sent email as a CRM activity/message and advance the deal.",
    mutating: true,
    inputSchema: InputSchema,
    async execute(input) {
      return store.recordOutboundEmail(input);
    },
  };
}
