import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { gmail_v1 } from "googleapis";
import { AgentRuntime } from "../src/runtime/agent-runtime.js";
import { ModelRouter } from "../src/runtime/model-router.js";
import { FakeModelProvider } from "../src/runtime/model-providers/fake.js";
import { ToolRegistry } from "../src/runtime/tool-registry.js";
import { DefaultPolicyEngine } from "../src/runtime/policy-engine.js";
import { DEFAULT_POLICY_RULES } from "../src/policy/default-rules.js";
import { createGetUnreadRepliesTool } from "../src/tools/get-unread-replies.js";
import { createMarkEmailReadTool } from "../src/tools/mark-email-read.js";
import { createRecordInboundReplyTool } from "../src/tools/record-inbound-reply.js";
import { createCloseDealLostTool } from "../src/tools/close-deal-lost.js";
import { createFlagDealForReviewTool } from "../src/tools/flag-deal-for-review.js";
import { createNotifyGavinTool } from "../src/tools/notify-gavin.js";
import { createSendEmailTool } from "../src/tools/send-email.js";
import { createRecordOutboundEmailTool } from "../src/tools/record-outbound-email.js";
import { createCreateEscalationTaskTool } from "../src/tools/create-escalation-task.js";
import { createAppendCompanyNoteTool } from "../src/tools/append-company-note.js";
import type { GmailReader, GmailSender, SendEmailInput, SendEmailResult, UnreadMessageRef } from "../src/integrations/gmail.js";
import { NotImplementedWriteStore } from "../src/db/hartwich-os/write-store-stub.js";
import type { RecordInboundReplyInput, RecordOutboundEmailInput, CreateTaskInput } from "../src/db/hartwich-os/write-store.js";
import type { OptOutStore } from "../src/outreach/opt-out-store.js";
import type { OutreachControlStore } from "../src/outreach/outreach-control-store.js";
import type { EmailAccountsStore, EmailAccountState } from "../src/db/hartwich-os/email-accounts-store.js";
import { HandleInboundRepliesPipeline } from "../src/pipelines/handle-inbound-replies.js";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const CONTACT_ID = "22222222-2222-4222-8222-222222222222";
const DEAL_ID = "33333333-3333-4333-8333-333333333333";
const WEEKDAY_BUSINESS_HOURS = new Date("2026-01-07T16:00:00Z"); // Wed 10am Winnipeg

function buildGmailMessage(replyText: string): gmail_v1.Schema$Message {
  return {
    id: "gmail-msg-1",
    threadId: "thread-1",
    payload: {
      headers: [
        { name: "From", value: "Prospect <info@example-hvac.test>" },
        { name: "Message-Id", value: "<reply-1@mail.gmail.com>" },
      ],
      mimeType: "text/plain",
      body: { data: Buffer.from(replyText).toString("base64url") },
    },
  };
}

class FakeGmailReader implements GmailReader {
  markedRead: { accountIndex: number; messageId: string }[] = [];
  constructor(private replyText: string) {}
  async listUnread(accountIndex: 0 | 1 | 2): Promise<UnreadMessageRef[]> {
    return accountIndex === 0 ? [{ id: "gmail-msg-1", threadId: "thread-1" }] : [];
  }
  async getMessage(): Promise<gmail_v1.Schema$Message> {
    return buildGmailMessage(this.replyText);
  }
  async markRead(accountIndex: 0 | 1 | 2, messageId: string): Promise<void> {
    this.markedRead.push({ accountIndex, messageId });
  }
}

class FakeGmailSender implements GmailSender {
  sent: SendEmailInput[] = [];
  async send(input: SendEmailInput): Promise<SendEmailResult> {
    this.sent.push(input);
    return { messageId: `msg-${this.sent.length}`, fromAddress: "hartwichlabs@gmail.com", threadId: input.threadId ?? "thread-1" };
  }
}

class FakeWriteStore extends NotImplementedWriteStore {
  inboundRecorded: RecordInboundReplyInput[] = [];
  outboundRecorded: RecordOutboundEmailInput[] = [];
  closedLostDealIds: string[] = [];
  flaggedDealIds: string[] = [];
  tasksCreated: CreateTaskInput[] = [];
  notesAppended: { companyId: string; note: string }[] = [];
  async recordInboundReply(input: RecordInboundReplyInput) {
    this.inboundRecorded.push(input);
    return { activityId: "inbound-activity-1", messageId: "inbound-message-1" };
  }
  async recordOutboundEmail(input: RecordOutboundEmailInput) {
    this.outboundRecorded.push(input);
    return { activityId: "outbound-activity-1", messageId: "outbound-message-1" };
  }
  async moveDealToLostStage(dealId: string) {
    this.closedLostDealIds.push(dealId);
  }
  async flagDealForReview(dealId: string) {
    this.flaggedDealIds.push(dealId);
  }
  async createTask(input: CreateTaskInput) {
    this.tasksCreated.push(input);
    return { taskId: `task-${this.tasksCreated.length}` };
  }
  async appendCompanyNote(companyId: string, note: string) {
    this.notesAppended.push({ companyId, note });
  }
}

class FakeOptOutStore implements OptOutStore {
  suppressed: { email: string; reason: string }[] = [];
  async isSuppressed() {
    return false;
  }
  async suppress(email: string, reason: string) {
    this.suppressed.push({ email, reason });
  }
}

class FakeControlStore implements OutreachControlStore {
  async getState() {
    return { sendingPaused: false, pausedReason: null };
  }
  async pause() {}
  async resume() {}
}

class FakeAccountsStore implements EmailAccountsStore {
  async getState(accountIndex: 0 | 1 | 2): Promise<EmailAccountState> {
    return { accountIndex, warmupStartedAt: null, activeSendDays: 0, dailySendCount: 0, lastSentAt: null };
  }
  async recordSend() {}
}

function buildPipeline(opts: { replyText: string; classification: Record<string, unknown> }) {
  const gmailReader = new FakeGmailReader(opts.replyText);
  const gmailSender = new FakeGmailSender();
  const writeStore = new FakeWriteStore();
  const optOuts = new FakeOptOutStore();

  const matchThread = async () => ({
    companyId: COMPANY_ID,
    contactId: CONTACT_ID,
    dealId: DEAL_ID,
    company: { name: "Example HVAC Co.", website: null },
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
    .register(createRecordOutboundEmailTool(writeStore))
    .register(createCreateEscalationTaskTool(writeStore))
    .register(createAppendCompanyNoteTool(writeStore));

  const provider = new FakeModelProvider({
    responsesBySchema: {
      conversation_intelligence_agent_output: opts.classification,
      outreach_reply_agent_output: { subject: "Re: Quick note about your reviews", body: "Thanks for writing back..." },
      appointment_agent_output: { subject: "Re: Quick note about your reviews", body: "Great — here's the link..." },
    },
  });

  const policy = new DefaultPolicyEngine(DEFAULT_POLICY_RULES);
  const runtime = new AgentRuntime({
    modelRouter: new ModelRouter({ fast: provider, strong: provider }),
    tools,
    policy,
    audit: { record: async () => {} },
  });

  const pipeline = new HandleInboundRepliesPipeline({ runtime, tools, policy, optOuts, control: new FakeControlStore(), accounts: new FakeAccountsStore() });
  return { pipeline, gmailReader, gmailSender, writeStore, optOuts };
}

function classificationFixture(overrides: Record<string, unknown>) {
  return {
    classification: "INTERESTED",
    buyingIntent: 70,
    objections: [],
    requestedInfo: [],
    requestedFollowUpDate: null,
    isDecisionMaker: "unknown",
    appointmentIntent: false,
    sentiment: "positive",
    confidence: 90,
    summary: "Sounds interested.",
    ...overrides,
  };
}

describe("HandleInboundRepliesPipeline", () => {
  beforeEach(() => {
    process.env.HARTWICH_APP_URL = "https://hartwich-os.example.com";
    process.env.GAVIN_EMAIL = "gavinhartwich@gmail.com";
  });
  afterEach(() => {
    delete process.env.HARTWICH_APP_URL;
    delete process.env.GAVIN_EMAIL;
  });

  it("replies autonomously to an INTERESTED reply and marks it read", async () => {
    const { pipeline, gmailSender, writeStore, gmailReader } = buildPipeline({
      replyText: "This looks interesting, tell me more.",
      classification: classificationFixture({ classification: "INTERESTED" }),
    });

    const results = await pipeline.runAll(WEEKDAY_BUSINESS_HOURS);

    expect(results).toHaveLength(1);
    expect(results[0].outcome).toBe("replied");
    expect(writeStore.inboundRecorded).toHaveLength(1);
    expect(gmailSender.sent).toHaveLength(1);
    expect(writeStore.outboundRecorded[0].kind).toBe("reply");
    expect(gmailReader.markedRead).toHaveLength(1);
  });

  it("uses the Appointment Agent and includes a real booking link when appointment intent is detected", async () => {
    const { pipeline, gmailSender } = buildPipeline({
      replyText: "Sure, let's set up a call.",
      classification: classificationFixture({ classification: "INTERESTED", appointmentIntent: true }),
    });

    const results = await pipeline.runAll(WEEKDAY_BUSINESS_HOURS);

    expect(results[0].outcome).toBe("replied");
    expect(gmailSender.sent[0].body).toMatch(/here's the link/);
  });

  it("suppresses and does not reply on STOP_CONTACT", async () => {
    const { pipeline, gmailSender, optOuts } = buildPipeline({
      replyText: "Please stop emailing me.",
      classification: classificationFixture({ classification: "STOP_CONTACT" }),
    });

    const results = await pipeline.runAll(WEEKDAY_BUSINESS_HOURS);

    expect(results[0].outcome).toBe("suppressed");
    expect(optOuts.suppressed).toHaveLength(1);
    expect(optOuts.suppressed[0].email).toBe("info@example-hvac.test");
    expect(gmailSender.sent).toHaveLength(0);
  });

  it("closes the deal lost on NOT_INTERESTED without sending a reply", async () => {
    const { pipeline, gmailSender, writeStore } = buildPipeline({
      replyText: "Not interested, thanks.",
      classification: classificationFixture({ classification: "NOT_INTERESTED" }),
    });

    const results = await pipeline.runAll(WEEKDAY_BUSINESS_HOURS);

    expect(results[0].outcome).toBe("closed_lost");
    expect(writeStore.closedLostDealIds).toEqual([DEAL_ID]);
    expect(gmailSender.sent).toHaveLength(0);
    expect(writeStore.notesAppended).toHaveLength(1);
    expect(writeStore.notesAppended[0].companyId).toBe(COMPANY_ID);
    expect(writeStore.notesAppended[0].note).toMatch(/Closed lost — reply classified NOT_INTERESTED/);
  });

  it("escalates PRICE to Gavin instead of replying autonomously", async () => {
    const { pipeline, gmailSender, writeStore } = buildPipeline({
      replyText: "What would this cost us?",
      classification: classificationFixture({ classification: "PRICE" }),
    });

    const results = await pipeline.runAll(WEEKDAY_BUSINESS_HOURS);

    expect(results[0].outcome).toBe("escalated");
    expect(writeStore.flaggedDealIds).toEqual([DEAL_ID]);
    // notify_gavin sends via account 0 — the only "send" that happens for an escalation.
    expect(gmailSender.sent).toHaveLength(1);
    expect(gmailSender.sent[0].to).toBe("gavinhartwich@gmail.com");
    expect(writeStore.notesAppended).toHaveLength(1);
    expect(writeStore.notesAppended[0].companyId).toBe(COMPANY_ID);
    expect(writeStore.notesAppended[0].note).toMatch(/Escalated to Gavin — reply classified PRICE/);
    expect(writeStore.tasksCreated).toHaveLength(1);
    expect(writeStore.tasksCreated[0].companyId).toBe(COMPANY_ID);
    expect(writeStore.tasksCreated[0].dealId).toBe(DEAL_ID);
    expect(writeStore.tasksCreated[0].description).toMatch(/needs a human response/);
  });

  it("takes no action on an out-of-office auto-reply", async () => {
    const { pipeline, gmailSender, writeStore } = buildPipeline({
      replyText: "I am out of the office until next week.",
      classification: classificationFixture({ classification: "OUT_OF_OFFICE" }),
    });

    const results = await pipeline.runAll(WEEKDAY_BUSINESS_HOURS);

    expect(results[0].outcome).toBe("no_action");
    expect(gmailSender.sent).toHaveLength(0);
    // Still recorded as a real inbound activity, even though no action follows.
    expect(writeStore.inboundRecorded).toHaveLength(1);
  });
});
