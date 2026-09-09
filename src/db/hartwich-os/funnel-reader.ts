import { and, between, eq, sql } from "drizzle-orm";
import { getHartwichOsDb } from "./client.js";
import { auditLog, companies, deals, pipelineStages } from "./schema.js";
import type { Period } from "../../goals/types.js";

/**
 * Read-only aggregate queries over hartwich-os's CRM data, for the KPI and
 * Bottleneck engines (src/goals/*). Injectable — same pattern as every
 * other hartwich-os-facing piece in this repo — so those engines' tests
 * never need a live database.
 *
 * Every count is scoped by `createdAt`/`stageEnteredAt` falling inside the
 * goal's period — a company or deal is credited to the period it was
 * created/entered its current stage in, not retroactively re-attributed if
 * its status changes later. hartwich-os has no status-history table, so
 * this is the best available signal, not a perfect one (see the `note` on
 * the KpiValue results that use it).
 */
export interface FunnelReader {
  countCompaniesCreated(period: Period): Promise<number>;
  countCompaniesByStatus(status: "qualified" | "needs_review" | "disqualified", period: Period): Promise<number>;
  countDealsCreated(period: Period): Promise<number>;
  countDealsByStageName(stageName: string, period: Period): Promise<number>;
  countDealsWon(period: Period): Promise<number>;
  sumWonDealValue(period: Period): Promise<number>;
  /** For close_rate (Phase 8, SPEC.md §33) — mirrors countDealsWon but for pipeline_stages.is_lost. */
  countDealsLost(period: Period): Promise<number>;
  /**
   * Counts hartwich-os audit_log rows by exact `action` string (Phase 7
   * wrote every consequential write there). Phase 8 reuses it rather than
   * adding new bookkeeping: `email.cold_outreach_sent`/`email.follow_up_sent`
   * for outreach_sent/follow_ups_completed, `task.created` for
   * human_escalations — every one of these is already recorded for
   * Phase 7's own reasons.
   */
  countAuditAction(action: string, period: Period): Promise<number>;
}

export class PostgresFunnelReader implements FunnelReader {
  async countCompaniesCreated(period: Period): Promise<number> {
    const db = getHartwichOsDb();
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(companies)
      .where(between(companies.createdAt, period.start, period.end));
    return row?.count ?? 0;
  }

  async countCompaniesByStatus(
    status: "qualified" | "needs_review" | "disqualified",
    period: Period
  ): Promise<number> {
    const db = getHartwichOsDb();
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(companies)
      .where(and(eq(companies.status, status), between(companies.createdAt, period.start, period.end)));
    return row?.count ?? 0;
  }

  async countDealsCreated(period: Period): Promise<number> {
    const db = getHartwichOsDb();
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(deals)
      .where(between(deals.createdAt, period.start, period.end));
    return row?.count ?? 0;
  }

  async countDealsByStageName(stageName: string, period: Period): Promise<number> {
    const db = getHartwichOsDb();
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(deals)
      .innerJoin(pipelineStages, eq(deals.stageId, pipelineStages.id))
      .where(and(eq(pipelineStages.name, stageName), between(deals.stageEnteredAt, period.start, period.end)));
    return row?.count ?? 0;
  }

  async countDealsWon(period: Period): Promise<number> {
    const db = getHartwichOsDb();
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(deals)
      .innerJoin(pipelineStages, eq(deals.stageId, pipelineStages.id))
      .where(and(eq(pipelineStages.isWon, true), between(deals.stageEnteredAt, period.start, period.end)));
    return row?.count ?? 0;
  }

  async sumWonDealValue(period: Period): Promise<number> {
    const db = getHartwichOsDb();
    const [row] = await db
      .select({ sum: sql<string | null>`coalesce(sum(${deals.valueEstimate}), 0)` })
      .from(deals)
      .innerJoin(pipelineStages, eq(deals.stageId, pipelineStages.id))
      .where(and(eq(pipelineStages.isWon, true), between(deals.stageEnteredAt, period.start, period.end)));
    return row?.sum != null ? Number(row.sum) : 0;
  }

  async countDealsLost(period: Period): Promise<number> {
    const db = getHartwichOsDb();
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(deals)
      .innerJoin(pipelineStages, eq(deals.stageId, pipelineStages.id))
      .where(and(eq(pipelineStages.isLost, true), between(deals.stageEnteredAt, period.start, period.end)));
    return row?.count ?? 0;
  }

  async countAuditAction(action: string, period: Period): Promise<number> {
    const db = getHartwichOsDb();
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(auditLog)
      .where(and(eq(auditLog.action, action), between(auditLog.createdAt, period.start, period.end)));
    return row?.count ?? 0;
  }
}
