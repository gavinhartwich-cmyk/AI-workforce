import { z } from "zod";
import type { ToolDefinition } from "../runtime/types.js";
import { PostgresHartwichWriteStore, type HartwichWriteStore } from "../db/hartwich-os/write-store.js";

const InputSchema = z.object({ dealId: z.string().uuid() });

/** PRICE/HOSTILE escalation (Phase 6) — surfaces the deal for a human look, same flag hartwich-os's own cadence cron uses. */
export function createFlagDealForReviewTool(
  store: HartwichWriteStore = new PostgresHartwichWriteStore()
): ToolDefinition<z.infer<typeof InputSchema>, { ok: true }> {
  return {
    name: "flag_deal_for_review",
    description: "Flag a deal as needing a human look.",
    mutating: true,
    inputSchema: InputSchema,
    async execute(input) {
      await store.flagDealForReview(input.dealId);
      return { ok: true };
    },
  };
}
