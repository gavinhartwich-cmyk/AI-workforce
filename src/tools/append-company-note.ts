import { z } from "zod";
import type { ToolDefinition } from "../runtime/types.js";
import { PostgresHartwichWriteStore, type HartwichWriteStore } from "../db/hartwich-os/write-store.js";

const InputSchema = z.object({ companyId: z.string().uuid(), note: z.string().min(1) });

/** SPEC.md §32 "record decisions" — appends a timestamped line to the company's notes rather than overwriting anything Gavin wrote by hand. */
export function createAppendCompanyNoteTool(
  store: HartwichWriteStore = new PostgresHartwichWriteStore()
): ToolDefinition<z.infer<typeof InputSchema>, { ok: true }> {
  return {
    name: "append_company_note",
    description: "Append a timestamped note to a company's record in hartwich-os.",
    mutating: true,
    inputSchema: InputSchema,
    async execute(input, ctx) {
      await store.appendCompanyNote(input.companyId, input.note, ctx.agentId);
      return { ok: true };
    },
  };
}
