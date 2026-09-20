import { and, eq, isNotNull } from "drizzle-orm";
import { getHartwichOsDb } from "./client.js";
import { companies, emailDrafts } from "./schema.js";

export type PendingAiFollowUp = { draftId: string; companyName: string };

/**
 * Read-only: AI-drafted follow-ups sitting in hartwich-os's own
 * email_drafts queue, waiting on review — scoped to companies THIS repo
 * discovered (aiWorkforceCreated), since a manually-sourced deal's
 * follow-up is still Gavin/Noah's to approve (Gavin, 2026-09-20: "the
 * manual stuff is still approved by us"). aiRunId non-null is what marks a
 * draft as AI-drafted in the first place — hartwich-os's own cadence.ts
 * always sets it for a follow-up.
 */
export interface FollowUpDraftReader {
  listPendingAiFollowUps(): Promise<PendingAiFollowUp[]>;
}

export class PostgresFollowUpDraftReader implements FollowUpDraftReader {
  async listPendingAiFollowUps(): Promise<PendingAiFollowUp[]> {
    const db = getHartwichOsDb();
    const rows = await db
      .select({ draftId: emailDrafts.id, companyName: companies.name })
      .from(emailDrafts)
      .innerJoin(companies, eq(emailDrafts.companyId, companies.id))
      .where(
        and(
          eq(emailDrafts.status, "pending_review"),
          eq(emailDrafts.kind, "follow_up"),
          isNotNull(emailDrafts.aiRunId),
          eq(companies.aiWorkforceCreated, true)
        )
      );
    return rows;
  }
}
