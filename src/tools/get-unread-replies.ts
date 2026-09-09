import { z } from "zod";
import { and, eq } from "drizzle-orm";
import type { ToolDefinition } from "../runtime/types.js";
import { GoogleGmailReader, extractFromAddress, extractHeader, extractPlainTextBody, type GmailReader } from "../integrations/gmail.js";
import { getHartwichOsDb } from "../db/hartwich-os/client.js";
import { activities, companies, contacts, deals, messages } from "../db/hartwich-os/schema.js";

const InputSchema = z.object({});

export type MatchedReply = {
  accountIndex: 0 | 1 | 2;
  gmailMessageId: string;
  threadId: string;
  fromAddress: string;
  rfc822MessageId: string | null;
  bodyText: string;
  companyId: string;
  contactId: string | null;
  dealId: string | null;
  company: { name: string; website: string | null };
  contact: { name: string | null; title: string | null } | null;
  originalSubject: string;
};

/**
 * Read-only: every unread message, across all 3 accounts, that is a reply
 * to something we sent (matched by Gmail threadId against hartwich-os's
 * own `messages` table — same matching rule as hartwich-os's own
 * sync-replies.ts). An unread message that ISN'T a reply to one of our
 * threads is not ours to act on and isn't returned — the caller (Phase
 * 6's pipeline) still needs to mark it read via mark_email_read so it
 * isn't refetched forever.
 */
export function createGetUnreadRepliesTool(
  reader: GmailReader = new GoogleGmailReader(),
  matchThread: (threadId: string) => Promise<Omit<MatchedReply, "accountIndex" | "gmailMessageId" | "threadId" | "fromAddress" | "rfc822MessageId" | "bodyText"> | null> = defaultMatchThread
): ToolDefinition<Record<string, never>, MatchedReply[]> {
  return {
    name: "get_unread_replies",
    description: "Fetch unread Gmail messages, across all 3 accounts, that reply to a thread we started.",
    mutating: false,
    inputSchema: InputSchema,
    async execute() {
      const results: MatchedReply[] = [];
      for (const accountIndex of [0, 1, 2] as const) {
        const refs = await reader.listUnread(accountIndex);
        for (const ref of refs) {
          const full = await reader.getMessage(accountIndex, ref.id);
          const matched = await matchThread(ref.threadId);
          if (!matched) continue; // not one of our threads — not ours to act on

          results.push({
            accountIndex,
            gmailMessageId: ref.id,
            threadId: ref.threadId,
            fromAddress: extractFromAddress(full),
            rfc822MessageId: extractHeader(full, "Message-Id"),
            bodyText: extractPlainTextBody(full) ?? "",
            ...matched,
          });
        }
      }
      return results;
    },
  };
}

async function defaultMatchThread(threadId: string) {
  const db = getHartwichOsDb();
  const sent = await db.query.messages.findFirst({
    where: and(eq(messages.provider, "gmail"), eq(messages.threadId, threadId)),
    orderBy: (m, { desc }) => desc(m.createdAt),
  });
  if (!sent) return null;

  const activity = sent.activityId ? await db.query.activities.findFirst({ where: eq(activities.id, sent.activityId) }) : null;
  if (!activity) return null;

  const company = await db.query.companies.findFirst({ where: eq(companies.id, activity.companyId) });
  if (!company) return null;

  const contact = activity.contactId ? await db.query.contacts.findFirst({ where: eq(contacts.id, activity.contactId) }) : null;
  const deal = activity.dealId ? await db.query.deals.findFirst({ where: eq(deals.id, activity.dealId) }) : null;

  return {
    companyId: company.id,
    contactId: contact?.id ?? null,
    dealId: deal?.id ?? null,
    company: { name: company.name, website: company.website },
    contact: contact ? { name: contact.name, title: contact.title } : null,
    originalSubject: sent.subject ?? "",
  };
}
