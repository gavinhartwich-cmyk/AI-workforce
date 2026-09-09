import type { AuditRecord, AuditSink } from "../runtime/types.js";
import { getDb } from "./client.js";
import { agentRuns } from "./schema.js";

/** Real audit sink — writes every run to this repo's own `agent_runs` table. */
export class PostgresAuditSink implements AuditSink {
  async record(entry: AuditRecord): Promise<void> {
    const db = getDb();
    await db.insert(agentRuns).values({
      runId: entry.runId,
      agentId: entry.agentId,
      agentVersion: entry.agentVersion,
      model: entry.model,
      startedAt: entry.startedAt,
      finishedAt: entry.finishedAt,
      input: entry.input,
      output: entry.output,
      toolCalls: entry.toolCalls,
      status: entry.status,
      error: entry.error ?? null,
    });
  }
}
