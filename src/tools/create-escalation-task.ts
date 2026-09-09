import { z } from "zod";
import type { ToolDefinition } from "../runtime/types.js";
import { PostgresHartwichWriteStore, type HartwichWriteStore } from "../db/hartwich-os/write-store.js";

const InputSchema = z.object({
  companyId: z.string().uuid().nullable(),
  dealId: z.string().uuid().nullable(),
  dueDate: z.coerce.date(),
  description: z.string().min(1),
});

/** SPEC.md §32 "create tasks" — an escalation (PRICE/HOSTILE) also lands on Gavin's existing /calendar page, not only as an email alert (src/tools/notify-gavin.ts). */
export function createCreateEscalationTaskTool(
  store: HartwichWriteStore = new PostgresHartwichWriteStore()
): ToolDefinition<z.infer<typeof InputSchema>, { taskId: string }> {
  return {
    name: "create_escalation_task",
    description: "Create a hartwich-os task for a conversation that needs Gavin's attention.",
    mutating: true,
    inputSchema: InputSchema,
    async execute(input, ctx) {
      return store.createTask(input, ctx.agentId);
    },
  };
}
