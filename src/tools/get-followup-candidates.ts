import { z } from "zod";
import { and, desc, eq, isNull, isNotNull } from "drizzle-orm";
import type { ToolDefinition } from "../runtime/types.js";
import { getHartwichOsDb } from "../db/hartwich-os/client.js";
import { activities, companies, contacts, deals, messages, pipelineStages } from "../db/hartwich-os/schema.js";

const InputSchema = z.object({});

export type FollowUpCandidateTarget = {
  dealId: string;
  companyId: string;
  company: { name: string; website: string | null };
  contact: { id: string; name: string | null; title: string | null; email: string | null } | null;
  lastOutboundEmailAt: Date;
  lastInboundEmailAt: Date | null;
  followUpCount: number;
  lastMessage: { subject: string; body: string } | null;
};

/**
 * Read-only: deals sitting in "Contacted" with no reply yet and not
 * already flagged for review — the raw candidate pool. Whether one is
 * actually DUE for a follow-up today is src/outreach/followup-cadence.ts's
 * job (a pure function, easy to test without a database); this tool just
 * gathers what a cadence check needs to decide.
 */
export function createGetFollowUpCandidatesTool(
  list: () => Promise<FollowUpCandidateTarget[]> = defaultList
): ToolDefinition<Record<string, never>, FollowUpCandidateTarget[]> {
  return {
    name: "get_followup_candidates",
    description: "List deals in Contacted with no reply yet, not already flagged for review.",
    mutating: false,
    inputSchema: InputSchema,
    async execute() {
      return list();
    },
  };
}

async function defaultList(): Promise<FollowUpCandidateTarget[]> {
  const db = getHartwichOsDb();

  const candidateDeals = await db
    .select({ deal: deals })
    .from(deals)
    .innerJoin(pipelineStages, eq(deals.stageId, pipelineStages.id))
    .where(
      and(eq(pipelineStages.name, "Contacted"), isNotNull(deals.lastOutboundEmailAt), isNull(deals.followUpFlaggedAt))
    );

  const results: FollowUpCandidateTarget[] = [];
  for (const { deal } of candidateDeals) {
    const company = await db.query.companies.findFirst({ where: eq(companies.id, deal.companyId) });
    if (!company) continue;

    const contact = await db.query.contacts.findFirst({
      where: and(eq(contacts.companyId, deal.companyId), eq(contacts.isPrimary, true)),
    });

    const lastOutbound = await db
      .select({ subject: messages.subject, body: messages.body })
      .from(messages)
      .innerJoin(activities, eq(messages.activityId, activities.id))
      .where(and(eq(activities.dealId, deal.id), eq(activities.direction, "outbound")))
      .orderBy(desc(activities.occurredAt))
      .limit(1);

    results.push({
      dealId: deal.id,
      companyId: deal.companyId,
      company: { name: company.name, website: company.website },
      contact: contact ? { id: contact.id, name: contact.name, title: contact.title, email: contact.email } : null,
      lastOutboundEmailAt: deal.lastOutboundEmailAt!,
      lastInboundEmailAt: deal.lastInboundEmailAt,
      followUpCount: deal.followUpCount,
      lastMessage: lastOutbound[0] ? { subject: lastOutbound[0].subject ?? "", body: lastOutbound[0].body ?? "" } : null,
    });
  }
  return results;
}
