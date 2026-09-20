import { z } from "zod";
import type { ToolDefinition } from "../runtime/types.js";
import { PostgresHartwichWriteStore, type HartwichWriteStore } from "../db/hartwich-os/write-store.js";

const InputSchema = z.object({
  companyId: z.string().uuid(),
  contactId: z.string().uuid(),
  dealId: z.string().uuid().nullable(),
  subject: z.string().min(1),
  body: z.string().min(1),
  kind: z.enum(["cold_outreach", "follow_up", "bounce_correction", "reply"]),
});

/**
 * The one mutating tool in Phase 4 — writes a pending-review draft into
 * hartwich-os's EXISTING email_drafts approval queue (see
 * src/db/hartwich-os/write-store.ts). Creating a draft doesn't reach the
 * prospect — SPEC.md §17 lists "generate outreach" as autonomous, routine
 * work; only the send (Phase 5) is a different, higher bar.
 */
export function createCreateEmailDraftTool(
  store: HartwichWriteStore = new PostgresHartwichWriteStore()
): ToolDefinition<z.infer<typeof InputSchema>, { draftId: string }> {
  return {
    name: "create_email_draft",
    description: "Create a pending-review outreach email draft in hartwich-os.",
    mutating: true,
    inputSchema: InputSchema,
    async execute(input, ctx) {
      return store.createEmailDraft(input, ctx.agentId);
    },
  };
}
