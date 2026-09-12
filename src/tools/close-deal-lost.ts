import { z } from "zod";
import type { ToolDefinition } from "../runtime/types.js";
import { PostgresHartwichWriteStore, type HartwichWriteStore } from "../db/hartwich-os/write-store.js";

const InputSchema = z.object({ dealId: z.string().uuid() });

/** NOT_INTERESTED/ALREADY_HAS_SOLUTION (Phase 6) — moves the deal to Lost so it exits the active pipeline and the follow-up candidate pool. */
export function createCloseDealLostTool(
  store: HartwichWriteStore = new PostgresHartwichWriteStore()
): ToolDefinition<z.infer<typeof InputSchema>, { ok: true }> {
  return {
    name: "close_deal_lost",
    description: "Move a deal to the Lost pipeline stage.",
    mutating: true,
    inputSchema: InputSchema,
    async execute(input, ctx) {
      await store.moveDealToLostStage(input.dealId, ctx.agentId);
      return { ok: true };
    },
  };
}
