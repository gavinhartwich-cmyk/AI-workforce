import { asc } from "drizzle-orm";
import { getHartwichOsDb } from "./client.js";
import { companies, contacts, deals, emailDrafts, pipelineStages } from "./schema.js";

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

/**
 * The write path into hartwich-os's CRM — kept behind an interface
 * (rather than tools calling Drizzle directly) so tests can substitute an
 * in-memory fake instead of a live database, same pattern as every other
 * tool in src/tools/.
 */
export interface HartwichWriteStore {
  persistDiscoveredCompany(input: PersistDiscoveredCompanyInput): Promise<PersistDiscoveredCompanyResult>;
  createEmailDraft(input: CreateEmailDraftInput): Promise<CreateEmailDraftResult>;
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
}
