import { and, between, eq, sql } from "drizzle-orm";
import { getDb } from "./client.js";
import { agentRuns, suppressedContacts } from "./schema.js";
import type { Period } from "../goals/types.js";

/**
 * Read-only aggregate queries over THIS repo's own database, for the Sales
 * Analyst's quality metrics (SPEC.md §33) — separate from AgentHealthReader
 * (agent success/failure, a runtime-health concern) and FunnelReader
 * (hartwich-os's CRM data). Injectable, same pattern as those two, so the
 * KPI Engine's tests never need a live database.
 */
export interface AnalyticsReader {
  /**
   * Genuine positive signal, not "any reply" — Conversation Intelligence
   * (Phase 6) classifies every reply, but only INTERESTED represents
   * someone actually receptive (src/outreach/reply-routing.ts treats
   * QUESTION/OBJECTION/NOT_NOW/WRONG_PERSON/REFERRAL the same as
   * INTERESTED for routing purposes — an autonomous reply — but they
   * aren't a buying signal the way INTERESTED is).
   */
  countPositiveConversations(period: Period): Promise<number>;
  /** SPEC.md §33's "opt-outs" quality metric — from this repo's own suppressed_contacts, not hartwich-os. */
  countOptOuts(period: Period): Promise<number>;
}

export class PostgresAnalyticsReader implements AnalyticsReader {
  async countPositiveConversations(period: Period): Promise<number> {
    const db = getDb();
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.agentId, "conversation_intelligence_agent"),
          eq(agentRuns.status, "succeeded"),
          sql`${agentRuns.output} ->> 'classification' = 'INTERESTED'`,
          between(agentRuns.createdAt, period.start, period.end)
        )
      );
    return row?.count ?? 0;
  }

  async countOptOuts(period: Period): Promise<number> {
    const db = getDb();
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(suppressedContacts)
      .where(between(suppressedContacts.suppressedAt, period.start, period.end));
    return row?.count ?? 0;
  }
}
