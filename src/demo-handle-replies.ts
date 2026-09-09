/**
 * Phase 6 demo — classify one inbound reply and route it, end to end
 * against fixtures (no Gmail/HARTWICH_DATABASE_URL credentials needed).
 * Shows the full autonomous path: reply comes in -> classified -> the
 * Appointment Agent hands back a real hartwich-os booking link -> sent
 * in-thread -> recorded as a CRM activity. No approval step.
 *
 * Run with: npm run demo:handle-replies
 */
import "dotenv/config";
import type { gmail_v1 } from "googleapis";
import { AgentRuntime } from "./runtime/agent-runtime.js";
import { ModelRouter } from "./runtime/model-router.js";
import { FakeModelProvider } from "./runtime/model-providers/fake.js";
import { ToolRegistry } from "./runtime/tool-registry.js";
import { DefaultPolicyEngine } from "./runtime/policy-engine.js";
import { DEFAULT_POLICY_RULES } from "./policy/default-rules.js";
import { createGetUnreadRepliesTool } from "./tools/get-unread-replies.js";
import { createMarkEmailReadTool } from "./tools/mark-email-read.js";
import { createRecordInboundReplyTool } from "./tools/record-inbound-reply.js";
import { createCloseDealLostTool } from "./tools/close-deal-lost.js";
import { createFlagDealForReviewTool } from "./tools/flag-deal-for-review.js";
import { createNotifyGavinTool } from "./tools/notify-gavin.js";
import { createSendEmailTool } from "./tools/send-email.js";
import { createRecordOutboundEmailTool } from "./tools/record-outbound-email.js";
import type { GmailReader, GmailSender, SendEmailInput, SendEmailResult, UnreadMessageRef } from "./integrations/gmail.js";
import { NotImplementedWriteStore } from "./db/hartwich-os/write-store-stub.js";
import type { RecordOutboundEmailInput } from "./db/hartwich-os/write-store.js";
import type { OptOutStore } from "./outreach/opt-out-store.js";
import type { OutreachControlStore } from "./outreach/outreach-control-store.js";
import type { EmailAccountsStore, EmailAccountState } from "./db/hartwich-os/email-accounts-store.js";
import { HandleInboundRepliesPipeline } from "./pipelines/handle-inbound-replies.js";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const CONTACT_ID = "22222222-2222-4222-8222-222222222222";
const DEAL_ID = "33333333-3333-4333-8333-333333333333";
const WEEKDAY_BUSINESS_HOURS = new Date("2026-01-07T16:00:00Z"); // Wed 10am Winnipeg
const REPLY_TEXT = "Oh wow, this is exactly what we need. Can we set up a quick call?";

process.env.HARTWICH_APP_URL ??= "https://hartwich-os-demo.example.com";

class FixtureGmailReader implements GmailReader {
  async listUnread(accountIndex: 0 | 1 | 2): Promise<UnreadMessageRef[]> {
    return accountIndex === 0 ? [{ id: "gmail-msg-1", threadId: "thread-1" }] : [];
  }
  async getMessage(): Promise<gmail_v1.Schema$Message> {
    return {
      id: "gmail-msg-1",
      threadId: "thread-1",
      payload: {
        headers: [
          { name: "From", value: "Prospect <info@example-hvac.test>" },
          { name: "Message-Id", value: "<reply-1@mail.gmail.com>" },
        ],
        mimeType: "text/plain",
        body: { data: Buffer.from(REPLY_TEXT).toString("base64url") },
      },
    };
  }
  async markRead(accountIndex: 0 | 1 | 2, messageId: string): Promise<void> {
    console.log(`  → would mark account ${accountIndex}'s message ${messageId} read.`);
  }
}

class PrintingGmailSender implements GmailSender {
  async send(input: SendEmailInput): Promise<SendEmailResult> {
    console.log(`\n  → SENDING (account ${input.accountIndex}, in-thread reply) to ${input.to}:`);
    console.log(`    Subject: ${input.subject}`);
    console.log(`    Body: ${input.body}`);
    return { messageId: "demo-reply-msg-1", fromAddress: "hartwichlabs@gmail.com", threadId: input.threadId ?? "thread-1" };
  }
}

class PrintingWriteStore extends NotImplementedWriteStore {
  async recordInboundReply() {
    console.log(`  → would record the inbound reply and move the deal to "Engaged".`);
    return { activityId: "demo-inbound-activity", messageId: "demo-inbound-message" };
  }
  async recordOutboundEmail(input: RecordOutboundEmailInput) {
    console.log(`  → would record this "${input.kind}" as a hartwich-os activity/message.`);
    return { activityId: "demo-outbound-activity", messageId: "demo-outbound-message" };
  }
}

class NoOptOuts implements OptOutStore {
  async isSuppressed() {
    return false;
  }
  async suppress(email: string, reason: string) {
    console.log(`  → would suppress ${email}: ${reason}`);
  }
}
class NotPaused implements OutreachControlStore {
  async getState() {
    return { sendingPaused: false, pausedReason: null };
  }
  async pause() {}
  async resume() {}
}
class FreshAccounts implements EmailAccountsStore {
  async getState(accountIndex: 0 | 1 | 2): Promise<EmailAccountState> {
    return { accountIndex, warmupStartedAt: null, dailySendCount: 0, lastSentAt: null };
  }
  async recordSend() {}
}

async function main() {
  const gmailReader = new FixtureGmailReader();
  const gmailSender = new PrintingGmailSender();
  const writeStore = new PrintingWriteStore();

  const matchThread = async () => ({
    companyId: COMPANY_ID,
    contactId: CONTACT_ID,
    dealId: DEAL_ID,
    company: { name: "Example HVAC Co.", website: "https://example-hvac.test" },
    contact: { name: null, title: null },
    originalSubject: "Quick note about your reviews",
  });

  const tools = new ToolRegistry()
    .register(createGetUnreadRepliesTool(gmailReader, matchThread))
    .register(createMarkEmailReadTool(gmailReader))
    .register(createRecordInboundReplyTool(writeStore))
    .register(createCloseDealLostTool(writeStore))
    .register(createFlagDealForReviewTool(writeStore))
    .register(createNotifyGavinTool(gmailSender))
    .register(createSendEmailTool(gmailSender))
    .register(createRecordOutboundEmailTool(writeStore));

  const provider = new FakeModelProvider({
    responsesBySchema: {
      conversation_intelligence_agent_output: {
        classification: "INTERESTED",
        buyingIntent: 85,
        objections: [],
        requestedInfo: [],
        requestedFollowUpDate: null,
        isDecisionMaker: "unknown",
        appointmentIntent: true,
        sentiment: "positive",
        confidence: 95,
        summary: "Excited and wants to book a call.",
      },
      appointment_agent_output: {
        subject: "Re: Quick note about your reviews",
        body: `Great to hear! Here's a link to grab a time that works for you: ${process.env.HARTWICH_APP_URL}/book?company=${COMPANY_ID}&contact=${CONTACT_ID}&deal=${DEAL_ID}\n\nTalk soon,\nGavin`,
      },
    },
  });

  const policy = new DefaultPolicyEngine(DEFAULT_POLICY_RULES);
  const runtime = new AgentRuntime({
    modelRouter: new ModelRouter({ fast: provider, strong: provider }),
    tools,
    policy,
    audit: { record: async () => {} },
  });

  const pipeline = new HandleInboundRepliesPipeline({
    runtime,
    tools,
    policy,
    optOuts: new NoOptOuts(),
    control: new NotPaused(),
    accounts: new FreshAccounts(),
  });

  console.log(`Reply received: "${REPLY_TEXT}"\n`);
  const results = await pipeline.runAll(WEEKDAY_BUSINESS_HOURS);
  console.log(`\nOutcome: ${results[0]?.outcome}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
