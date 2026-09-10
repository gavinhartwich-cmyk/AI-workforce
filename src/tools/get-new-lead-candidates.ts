import { z } from "zod";
import { eq } from "drizzle-orm";
import type { ToolDefinition } from "../runtime/types.js";
import { getHartwichOsDb } from "../db/hartwich-os/client.js";
import { deals, pipelineStages } from "../db/hartwich-os/schema.js";

const InputSchema = z.object({});

/**
 * Read-only: company ids for every deal still sitting in "New Lead" —
 * i.e. qualified into a deal by Phase 2's discovery/qualification
 * pipeline but never contacted. This is the candidate pool
 * `ExecuteOutreachPipeline.run(companyId)` (Phase 5) needs a companyId
 * for; that pipeline already re-checks contact/deal/stage itself
 * (`get_outreach_target`), so this tool stays a plain list — same split
 * of responsibility as `get_followup_candidates` (raw pool) vs.
 * `followup-cadence.ts` (whether one is actually due).
 */
export function createGetNewLeadCandidatesTool(
  list: () => Promise<string[]> = defaultList
): ToolDefinition<Record<string, never>, string[]> {
  return {
    name: "get_new_lead_candidates",
    description: "List company ids for deals sitting in \"New Lead\" — qualified but never contacted.",
    mutating: false,
    inputSchema: InputSchema,
    async execute() {
      return list();
    },
  };
}

/** Exported directly (not just as a tool) so a cron/orchestration entrypoint
 * can enumerate candidates without standing up a ToolExecutor for a plain
 * read — same reasoning as calling a store straight from a CLI script. */
export async function defaultList(): Promise<string[]> {
  const db = getHartwichOsDb();
  const rows = await db
    .select({ companyId: deals.companyId })
    .from(deals)
    .innerJoin(pipelineStages, eq(deals.stageId, pipelineStages.id))
    .where(eq(pipelineStages.name, "New Lead"));
  return [...new Set(rows.map((r) => r.companyId))];
}
