import { and, asc, eq, sql } from "drizzle-orm";
import { getHartwichOsDb } from "./client.js";
import { activities, companies, contacts, deals, emailDrafts, messages, pipelineStages } from "./schema.js";

export type PersistDiscoveredCompanyInput = {
  place: {
    name: string;
    address: string | null;
    phone: string | null;
    website: string | null;
    rating: number | null;
    userRatingCount: number | null;
  };
  placeId: string;
  status: "qualified" | "needs_review" | "disqualified";
  qualificationScore: number;
  qualificationReasoning: string;
  contactTier: "A" | "B" | "C" | null;
  isOwnerOperated: boolean | null;
  isFranchise: boolean;
  disqualifyReason: string | null;
  enrichment: {
    summary: string | null;
    servicesOffered: string[] | null;
    apparentSize: string | null;
    contactName: string | null;
    contactTitle: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    contactLinkedinUrl: string | null;
    fallbackEmail: string | null;
  } | null;
};

export type PersistDiscoveredCompanyResult = {
  companyId: string;
  contactId: string | null;
  dealId: string | null;
};

export type CreateEmailDraftInput = {
  companyId: string;
  contactId: string;
  dealId: string | null;
  subject: string;
  body: string;
  kind: "cold_outreach" | "follow_up" | "bounce_correction" | "reply";
};

export type CreateEmailDraftResult = { draftId: string };

export type RecordOutboundEmailInput = {
  companyId: string;
  contactId: string | null;
  dealId: string;
  kind: "cold_outreach" | "follow_up" | "reply";
  accountIndex: 0 | 1 | 2;
  to: string;
  fromAddress: string;
  subject: string;
  body: string;
  providerMessageId: string;
  threadId: string | null;
};

export type RecordOutboundEmailResult = { activityId: string; messageId: string };

export type RecordInboundReplyInput = {
  companyId: string;
  contactId: string | null;
  dealId: string | null;
  fromAddress: string;
  subject: string;
  body: string;
  providerMessageId: string;
  threadId: string;
};

export type RecordInboundReplyResult = { activityId: string; messageId: string };

/**
 * The write path into hartwich-os's CRM — kept behind an interface
 * (rather than tools calling Drizzle directly) so tests can substitute an
 * in-memory fake instead of a live database, same pattern as every other
 * tool in src/tools/.
 */
export interface HartwichWriteStore {
  persistDiscoveredCompany(input: PersistDiscoveredCompanyInput): Promise<PersistDiscoveredCompanyResult>;
  createEmailDraft(input: CreateEmailDraftInput): Promise<CreateEmailDraftResult>;
  recordOutboundEmail(input: RecordOutboundEmailInput): Promise<RecordOutboundEmailResult>;
  recordInboundReply(input: RecordInboundReplyInput): Promise<RecordInboundReplyResult>;
  moveDealToLostStage(dealId: string): Promise<void>;
  flagDealForReview(dealId: string): Promise<void>;
}

/**
 * Mirrors hartwich-os's own createDiscoveredCompany
 * (hartwich-os/src/lib/data/companies.ts) field-for-field and
 * transaction-for-transaction: always write the company (even a
 * disqualified one, so a future re-run's dedupe check skips it without
 * re-spending API/AI cost); create a contact only if enrichment found a
 * name/email/phone/LinkedIn; create a deal — into the lowest-position
 * pipeline stage — only when status is "qualified".
 */
export class PostgresHartwichWriteStore implements HartwichWriteStore {
  async persistDiscoveredCompany(
    input: PersistDiscoveredCompanyInput
  ): Promise<PersistDiscoveredCompanyResult> {
    const db = getHartwichOsDb();

    return db.transaction(async (tx) => {
      const [company] = await tx
        .insert(companies)
        .values({
          name: input.place.name,
          website: input.place.website,
          phone: input.place.phone,
          addressLine: input.place.address,
          source: "google_places",
          sourceRefId: input.placeId,
          googleReviewCount: input.place.userRatingCount,
          googleRating: input.place.rating != null ? input.place.rating.toFixed(2) : null,
          isOwnerOperated: input.isOwnerOperated,
          isFranchise: input.isFranchise,
          contactTier: input.contactTier,
          qualificationScore: input.qualificationScore,
          qualificationReasoning: input.qualificationReasoning,
          disqualifyReason: input.disqualifyReason,
          websiteSummary: input.enrichment?.summary || null,
          servicesOffered: input.enrichment?.servicesOffered || null,
          apparentSize: input.enrichment?.apparentSize || null,
          status: input.status,
        })
        .returning();

      const en = input.enrichment;
      const email = en?.contactEmail || en?.fallbackEmail || null;
      let contactId: string | null = null;
      if (en?.contactName || email || en?.contactPhone || en?.contactLinkedinUrl) {
        const [contact] = await tx
          .insert(contacts)
          .values({
            companyId: company.id,
            name: en?.contactName || null,
            title: en?.contactTitle || (!en?.contactName && email ? "General inquiries" : null),
            email,
            phone: en?.contactPhone || null,
            linkedinUrl: en?.contactLinkedinUrl || null,
            isPrimary: true,
            source: "google_places",
          })
          .returning();
        contactId = contact.id;
      }

      let dealId: string | null = null;
      if (input.status === "qualified") {
        const [firstStage] = await tx
          .select()
          .from(pipelineStages)
          .orderBy(asc(pipelineStages.position))
          .limit(1);

        if (firstStage) {
          const [deal] = await tx
            .insert(deals)
            .values({ companyId: company.id, stageId: firstStage.id })
            .returning();
          dealId = deal.id;
        }
      }

      return { companyId: company.id, contactId, dealId };
    });
  }

  /**
   * Writes into hartwich-os's EXISTING email_drafts approval queue
   * (hartwich-os/PHASE_3.md) — Gavin already has a review UI for this in
   * hartwich-os today, so Phase 4 drafts land where he already looks,
   * rather than a second inbox. Always pending_review: nothing this repo
   * writes here ever sends by itself (SPEC.md's Phase 4/5 split — Phase 4
   * generates, Phase 5 is what's allowed to execute).
   */
  async createEmailDraft(input: CreateEmailDraftInput): Promise<CreateEmailDraftResult> {
    const db = getHartwichOsDb();
    const [draft] = await db
      .insert(emailDrafts)
      .values({
        companyId: input.companyId,
        contactId: input.contactId,
        dealId: input.dealId,
        subject: input.subject,
        body: input.body,
        status: "pending_review",
        kind: input.kind,
      })
      .returning();
    return { draftId: draft.id };
  }

  /**
   * Records an autonomous send exactly like a human-sent one — same
   * activity/message shape hartwich-os's own sendApprovedDraft
   * (src/lib/emails/send-approved-draft.ts) writes — and advances the
   * deal the same way hartwich-os's applyPostSendDealUpdate does: a cold
   * outreach send moves New Lead -> Contacted; a follow-up send increments
   * followUpCount and clears the "needs a look" flag without changing
   * stage. This IS the visibility mechanism for autonomous sending
   * (Gavin, 2026-09-XX) — it shows up in hartwich-os's own company/deal
   * timeline, not a separate log only this repo can see.
   */
  async recordOutboundEmail(input: RecordOutboundEmailInput): Promise<RecordOutboundEmailResult> {
    const db = getHartwichOsDb();
    const now = new Date();

    return db.transaction(async (tx) => {
      const [activity] = await tx
        .insert(activities)
        .values({
          companyId: input.companyId,
          contactId: input.contactId,
          dealId: input.dealId,
          type: "email",
          direction: "outbound",
          bodyText: input.body,
          aiGenerated: true,
          occurredAt: now,
        })
        .returning();

      const [message] = await tx
        .insert(messages)
        .values({
          activityId: activity.id,
          provider: "gmail",
          providerMessageId: input.providerMessageId,
          threadId: input.threadId,
          status: "delivered",
          accountIndex: input.accountIndex,
          toAddress: input.to,
          fromAddress: input.fromAddress,
          subject: input.subject,
          body: input.body,
          generatedByAi: true,
        })
        .returning();

      if (input.kind === "cold_outreach") {
        const [contactedStage] = await tx.select().from(pipelineStages).where(eq(pipelineStages.name, "Contacted")).limit(1);
        await tx
          .update(deals)
          .set({
            ...(contactedStage ? { stageId: contactedStage.id, stageEnteredAt: now } : {}),
            lastOutboundEmailAt: now,
            updatedAt: now,
          })
          .where(eq(deals.id, input.dealId));
      } else if (input.kind === "follow_up") {
        await tx
          .update(deals)
          .set({
            lastOutboundEmailAt: now,
            followUpCount: sql`${deals.followUpCount} + 1`,
            followUpFlaggedAt: null,
            stageEnteredAt: now,
            updatedAt: now,
          })
          .where(eq(deals.id, input.dealId));
      } else {
        // reply: already in Engaged (recordInboundReply moved it there when
        // the inbound message came in) — just keep the cadence clock
        // current, same as hartwich-os's own applyPostSendDealUpdate.
        await tx.update(deals).set({ lastOutboundEmailAt: now, updatedAt: now }).where(eq(deals.id, input.dealId));
      }

      return { activityId: activity.id, messageId: message.id };
    });
  }

  /**
   * Records a genuine inbound reply (Phase 6) — mirrors hartwich-os's own
   * sync-replies.ts: log the inbound activity/message, mark the original
   * sent message "replied", clear any pending follow-up flag (a reply
   * supersedes the cadence — src/outreach/followup-cadence.ts's
   * isFollowUpDue also independently stops once lastInboundEmailAt is set,
   * this just keeps the flag itself tidy), and move Contacted -> Engaged.
   * hartwich-os doesn't special-case an out-of-office auto-reply here
   * either — same simplicity, not a gap unique to this repo.
   */
  async recordInboundReply(input: RecordInboundReplyInput): Promise<RecordInboundReplyResult> {
    const db = getHartwichOsDb();
    const now = new Date();

    return db.transaction(async (tx) => {
      const [activity] = await tx
        .insert(activities)
        .values({
          companyId: input.companyId,
          contactId: input.contactId,
          dealId: input.dealId,
          type: "email",
          direction: "inbound",
          bodyText: input.body,
          aiGenerated: false,
          occurredAt: now,
        })
        .returning();

      const [message] = await tx
        .insert(messages)
        .values({
          activityId: activity.id,
          provider: "gmail",
          providerMessageId: input.providerMessageId,
          threadId: input.threadId,
          status: "delivered",
          fromAddress: input.fromAddress,
          subject: input.subject,
          body: input.body,
          generatedByAi: false,
        })
        .returning();

      await tx.update(messages).set({ status: "replied" }).where(and(eq(messages.threadId, input.threadId), eq(messages.provider, "gmail")));

      if (input.dealId) {
        const [engagedStage] = await tx.select().from(pipelineStages).where(eq(pipelineStages.name, "Engaged")).limit(1);
        await tx
          .update(deals)
          .set({
            lastInboundEmailAt: now,
            followUpFlaggedAt: null,
            updatedAt: now,
            ...(engagedStage ? { stageId: engagedStage.id, stageEnteredAt: now } : {}),
          })
          .where(eq(deals.id, input.dealId));
      }

      return { activityId: activity.id, messageId: message.id };
    });
  }

  /** NOT_INTERESTED/ALREADY_HAS_SOLUTION (Phase 6) — closing the loop means the deal exits the active pipeline, not just "no more follow-ups." */
  async moveDealToLostStage(dealId: string): Promise<void> {
    const db = getHartwichOsDb();
    const [lostStage] = await db.select().from(pipelineStages).where(eq(pipelineStages.name, "Lost")).limit(1);
    if (!lostStage) return;
    await db
      .update(deals)
      .set({ stageId: lostStage.id, stageEnteredAt: new Date(), updatedAt: new Date() })
      .where(eq(deals.id, dealId));
  }

  /** PRICE/HOSTILE escalation (Phase 6) — reuses the same "needs a look" flag hartwich-os's own cadence cron sets, surfacing it the same way at the top of the board. */
  async flagDealForReview(dealId: string): Promise<void> {
    const db = getHartwichOsDb();
    await db.update(deals).set({ followUpFlaggedAt: new Date(), updatedAt: new Date() }).where(eq(deals.id, dealId));
  }
}
