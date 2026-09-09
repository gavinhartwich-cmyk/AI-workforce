import { asc } from "drizzle-orm";
import { getHartwichOsDb } from "./client.js";
import { companies, contacts, deals, pipelineStages } from "./schema.js";

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

/**
 * The one write path into hartwich-os's CRM for a discovered lead — kept
 * behind an interface (rather than the tool calling Drizzle directly) so
 * tests can substitute an in-memory fake instead of a live database, same
 * pattern as every other tool in src/tools/.
 */
export interface HartwichWriteStore {
  persistDiscoveredCompany(input: PersistDiscoveredCompanyInput): Promise<PersistDiscoveredCompanyResult>;
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
}
