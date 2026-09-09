import { describe, expect, it } from "vitest";
import { AgentRuntime } from "../src/runtime/agent-runtime.js";
import { ModelRouter } from "../src/runtime/model-router.js";
import { FakeModelProvider } from "../src/runtime/model-providers/fake.js";
import { ToolRegistry } from "../src/runtime/tool-registry.js";
import { DefaultPolicyEngine } from "../src/runtime/policy-engine.js";
import { DEFAULT_POLICY_RULES } from "../src/policy/default-rules.js";
import { createGetOutreachTargetTool, type OutreachTarget } from "../src/tools/get-outreach-target.js";
import { createSendEmailTool } from "../src/tools/send-email.js";
import { createRecordOutboundEmailTool } from "../src/tools/record-outbound-email.js";
import type { GmailSender, SendEmailInput, SendEmailResult } from "../src/integrations/gmail.js";
import type { RecordOutboundEmailInput } from "../src/db/hartwich-os/write-store.js";
import { NotImplementedWriteStore } from "../src/db/hartwich-os/write-store-stub.js";
import type { OptOutStore } from "../src/outreach/opt-out-store.js";
import type { OutreachControlStore, OutreachControlState } from "../src/outreach/outreach-control-store.js";
import type { EmailAccountsStore, EmailAccountState } from "../src/db/hartwich-os/email-accounts-store.js";
import { ExecuteOutreachPipeline } from "../src/pipelines/execute-outreach.js";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const WEEKDAY_BUSINESS_HOURS = new Date("2026-01-07T16:00:00Z"); // Wed 10am Winnipeg

const TARGET: OutreachTarget = {
  company: {
    id: COMPANY_ID,
    name: "Example HVAC Co.",
    website: "https://example-hvac.test",
    city: "Winnipeg",
    state: "MB",
    googleReviewCount: 3,
    googleRating: "3.20",
    qualificationScore: 69,
    qualificationReasoning: "Low review count, low rating.",
    websiteSummary: "Small local HVAC shop.",
    servicesOffered: ["furnace repair"],
    apparentSize: "small",
    notes: null,
  },
  contact: { id: "22222222-2222-4222-8222-222222222222", name: null, title: null, email: "info@example-hvac.test" },
  dealId: "33333333-3333-4333-8333-333333333333",
  dealStageName: "New Lead",
};

const STRATEGY_RESPONSE = {
  channel: "email",
  angle: "Low review count.",
  hook: "Only 3 Google reviews.",
  personalizationPoints: ["Located in Winnipeg, MB"],
  cta: "a quick call",
  reasoning: "Clear gap.",
};
const GENERATION_RESPONSE = {
  initial: { subject: "Quick note about your reviews", body: "Hi there, I noticed..." },
  followUps: [],
};

class FakeGmailSender implements GmailSender {
  sent: SendEmailInput[] = [];
  async send(input: SendEmailInput): Promise<SendEmailResult> {
    this.sent.push(input);
    return { messageId: `msg-${this.sent.length}`, fromAddress: "hartwichlabs@gmail.com", threadId: `thread-${this.sent.length}` };
  }
}

class FakeRecordStore extends NotImplementedWriteStore {
  recorded: RecordOutboundEmailInput[] = [];
  async recordOutboundEmail(input: RecordOutboundEmailInput) {
    this.recorded.push(input);
    return { activityId: `activity-${this.recorded.length}`, messageId: `record-${this.recorded.length}` };
  }
}

class FakeOptOutStore implements OptOutStore {
  constructor(private suppressed: Set<string> = new Set()) {}
  async isSuppressed(email: string) {
    return this.suppressed.has(email.toLowerCase());
  }
  async suppress() {}
}

class FakeControlStore implements OutreachControlStore {
  constructor(private state: OutreachControlState = { sendingPaused: false, pausedReason: null }) {}
  async getState() {
    return this.state;
  }
  async pause() {}
  async resume() {}
}

class FakeAccountsStore implements EmailAccountsStore {
  recordedSends: { accountIndex: number; at: Date }[] = [];
  async getState(accountIndex: 0 | 1 | 2): Promise<EmailAccountState> {
    return { accountIndex, warmupStartedAt: null, dailySendCount: 0, lastSentAt: null };
  }
  async recordSend(accountIndex: 0 | 1 | 2, at: Date) {
    this.recordedSends.push({ accountIndex, at });
  }
}

function buildPipeline(opts: {
  target: OutreachTarget | null;
  gmail?: FakeGmailSender;
  recordStore?: FakeRecordStore;
  optOuts?: OptOutStore;
  control?: OutreachControlStore;
  accounts?: FakeAccountsStore;
}) {
  const gmail = opts.gmail ?? new FakeGmailSender();
  const recordStore = opts.recordStore ?? new FakeRecordStore();
  const accounts = opts.accounts ?? new FakeAccountsStore();

  const tools = new ToolRegistry()
    .register(createGetOutreachTargetTool(async () => opts.target))
    .register(createSendEmailTool(gmail))
    .register(createRecordOutboundEmailTool(recordStore));

  const provider = new FakeModelProvider({
    responsesBySchema: {
      outreach_strategy_agent_output: STRATEGY_RESPONSE,
      outreach_generation_agent_output: GENERATION_RESPONSE,
    },
  });

  const policy = new DefaultPolicyEngine(DEFAULT_POLICY_RULES);
  const runtime = new AgentRuntime({
    modelRouter: new ModelRouter({ fast: provider, strong: provider }),
    tools,
    policy,
    audit: { record: async () => {} },
  });

  const pipeline = new ExecuteOutreachPipeline({
    runtime,
    tools,
    policy,
    optOuts: opts.optOuts ?? new FakeOptOutStore(),
    control: opts.control ?? new FakeControlStore(),
    accounts,
  });

  return { pipeline, gmail, recordStore, accounts };
}

describe("ExecuteOutreachPipeline", () => {
  it("sends autonomously and records the send in hartwich-os, no approval step", async () => {
    const { pipeline, gmail, recordStore, accounts } = buildPipeline({ target: TARGET });

    const result = await pipeline.run(COMPANY_ID, undefined, WEEKDAY_BUSINESS_HOURS);

    expect(result.outcome).toBe("sent");
    expect(gmail.sent).toHaveLength(1);
    expect(gmail.sent[0].to).toBe("info@example-hvac.test");
    expect(recordStore.recorded).toHaveLength(1);
    expect(recordStore.recorded[0].kind).toBe("cold_outreach");
    expect(accounts.recordedSends).toHaveLength(1);
  });

  it("never sends to a suppressed (opted-out) address", async () => {
    const { pipeline, gmail } = buildPipeline({
      target: TARGET,
      optOuts: new FakeOptOutStore(new Set(["info@example-hvac.test"])),
    });

    const result = await pipeline.run(COMPANY_ID, undefined, WEEKDAY_BUSINESS_HOURS);

    expect(result.outcome).toBe("suppressed");
    expect(gmail.sent).toHaveLength(0);
  });

  it("defers, doesn't send, while the kill switch is paused", async () => {
    const { pipeline, gmail } = buildPipeline({
      target: TARGET,
      control: new FakeControlStore({ sendingPaused: true, pausedReason: "manual pause" }),
    });

    const result = await pipeline.run(COMPANY_ID, undefined, WEEKDAY_BUSINESS_HOURS);

    expect(result.outcome).toBe("deferred");
    expect(gmail.sent).toHaveLength(0);
  });

  it("skips a company that's already past New Lead — never re-contacts", async () => {
    const { pipeline, gmail } = buildPipeline({ target: { ...TARGET, dealStageName: "Contacted" } });

    const result = await pipeline.run(COMPANY_ID, undefined, WEEKDAY_BUSINESS_HOURS);

    expect(result.outcome).toBe("already_contacted");
    expect(gmail.sent).toHaveLength(0);
  });

  it("skips a prospect with no contact email", async () => {
    const { pipeline, gmail } = buildPipeline({
      target: { ...TARGET, contact: { id: "c", name: null, title: null, email: null } },
    });

    const result = await pipeline.run(COMPANY_ID, undefined, WEEKDAY_BUSINESS_HOURS);

    expect(result.outcome).toBe("no_contact");
    expect(gmail.sent).toHaveLength(0);
  });
});
