import { z } from "zod";
import type { ToolDefinition } from "../runtime/types.js";
import { PostgresHartwichWriteStore, type HartwichWriteStore } from "../db/hartwich-os/write-store.js";

const InputSchema = z.object({ messageId: z.string().uuid(), reason: z.string().min(1) });

/** A detected Gmail bounce (src/outreach/bounce-detection.ts) — marks the sent message, never the deal's stage or a genuine-reply activity. */
export function createMarkMessageBouncedTool(
  store: HartwichWriteStore = new PostgresHartwichWriteStore()
): ToolDefinition<z.infer<typeof InputSchema>, { ok: true }> {
  return {
    name: "mark_message_bounced",
    description: "Mark a previously sent message as bounced, with the delivery-failure reason.",
    mutating: true,
    inputSchema: InputSchema,
    async execute(input, ctx) {
      await store.markMessageBounced(input, ctx.agentId);
      return { ok: true };
    },
  };
}
