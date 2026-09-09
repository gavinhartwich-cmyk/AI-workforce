import { z } from "zod";
import type { ToolDefinition } from "../runtime/types.js";
import { getHartwichOsDb } from "../db/hartwich-os/client.js";

const InputSchema = z.object({ companyId: z.string().uuid() });

export type OutreachTarget = {
  company: {
    id: string;
    name: string;
    website: string | null;
    city: string | null;
    state: string | null;
    googleReviewCount: number | null;
    googleRating: string | null;
    qualificationScore: number | null;
    qualificationReasoning: string | null;
    websiteSummary: string | null;
    servicesOffered: string[] | null;
    apparentSize: string | null;
    notes: string | null;
  };
  contact: { id: string; name: string | null; title: string | null; email: string | null } | null;
  dealId: string | null;
};

/**
 * Read-only lookup assembling everything Outreach Strategy/Generation need
 * about one qualified prospect — company record, primary contact (if
 * Research found one), and its open deal id (if it cleared auto-file).
 * `lookup` is injectable for tests, same pattern as every other tool here.
 */
export function createGetOutreachTargetTool(
  lookup: (companyId: string) => Promise<OutreachTarget | null> = defaultLookup
): ToolDefinition<z.infer<typeof InputSchema>, OutreachTarget | null> {
  return {
    name: "get_outreach_target",
    description: "Fetch a qualified company, its primary contact, and its deal id from hartwich-os's CRM.",
    mutating: false,
    inputSchema: InputSchema,
    async execute(input) {
      return lookup(input.companyId);
    },
  };
}

async function defaultLookup(companyId: string): Promise<OutreachTarget | null> {
  const db = getHartwichOsDb();

  const company = await db.query.companies.findFirst({ where: (c, { eq }) => eq(c.id, companyId) });
  if (!company) return null;

  const contact = await db.query.contacts.findFirst({
    where: (c, { eq, and }) => and(eq(c.companyId, companyId), eq(c.isPrimary, true)),
  });

  const deal = await db.query.deals.findFirst({ where: (d, { eq }) => eq(d.companyId, companyId) });

  return {
    company: {
      id: company.id,
      name: company.name,
      website: company.website,
      city: company.city,
      state: company.state,
      googleReviewCount: company.googleReviewCount,
      googleRating: company.googleRating,
      qualificationScore: company.qualificationScore,
      qualificationReasoning: company.qualificationReasoning,
      websiteSummary: company.websiteSummary,
      servicesOffered: company.servicesOffered,
      apparentSize: company.apparentSize,
      notes: company.notes,
    },
    contact: contact ? { id: contact.id, name: contact.name, title: contact.title, email: contact.email } : null,
    dealId: deal?.id ?? null,
  };
}
