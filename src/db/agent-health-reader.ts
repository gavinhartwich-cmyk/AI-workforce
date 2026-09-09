import { between, sql } from "drizzle-orm";
import { getDb } from "./client.js";
import { agentRuns } from "./schema.js";
import type { Period } from "../goals/types.js";

/**
 * Agent health, computed live from `agent_runs` (SPEC.md §43) rather than
 * a separately-maintained table — every AgentRuntime.run() already writes
 * a row here (Phase 1), so success rate is a query, not new bookkeeping.
 * "Capacity"/utilization (queue depth, concurrent task limits) isn't
 * implemented yet — there's no task queue for agents to be queued against
 * until a later phase actually needs concurrent agent scheduling; this
 * reader sticks to what's honestly measurable today.
 */
export interface AgentHealthReader {
  getSuccessRate(period: Period): Promise<{ total: number; succeeded: number }>;
}

export class PostgresAgentHealthReader implements AgentHealthReader {
  async getSuccessRate(period: Period): Promise<{ total: number; succeeded: number }> {
    const db = getDb();
    const [row] = await db
      .select({
        total: sql<number>`count(*)::int`,
        succeeded: sql<number>`count(*) filter (where ${agentRuns.status} = 'succeeded')::int`,
      })
      .from(agentRuns)
      .where(between(agentRuns.createdAt, period.start, period.end));
    return { total: row?.total ?? 0, succeeded: row?.succeeded ?? 0 };
  }
}
