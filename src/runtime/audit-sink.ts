import type { AuditRecord, AuditSink } from "./types.js";

/**
 * In-memory audit sink — used by tests and local demos so the runtime
 * pipeline is exercisable with no database configured. `PostgresAuditSink`
 * (src/db/postgres-audit-sink.ts) is the real implementation, writing to
 * this repo's own `agent_runs` table.
 */
export class InMemoryAuditSink implements AuditSink {
  readonly records: AuditRecord[] = [];

  async record(entry: AuditRecord): Promise<void> {
    this.records.push(entry);
  }
}
