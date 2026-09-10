import { describe, expect, it } from "vitest";
import { AgentRuntime } from "../src/runtime/agent-runtime.js";
import { ModelRouter } from "../src/runtime/model-router.js";
import { FakeModelProvider } from "../src/runtime/model-providers/fake.js";
import { ToolRegistry } from "../src/runtime/tool-registry.js";
import { DefaultPolicyEngine } from "../src/runtime/policy-engine.js";
import { DEFAULT_POLICY_RULES } from "../src/policy/default-rules.js";
import { createGetFollowUpCandidatesTool, type FollowUpCandidateTarget } from "../src/tools/get-followup-candidates.js";
import { createSendEmailTool } from "../src/tools/send-email.js";
import { createRecordOutboundEmailTool } from "../src/tools/record-outbound-email.js";
import type { GmailSender, SendEmailInput, SendEmailResult } from "../src/integrations/gmail.js";
import type { RecordOutboundEmailInput } from "../src/db/hartwich-os/write-store.js";
import { NotImplementedWriteStore } from "../src/db/hartwich-os/write-store-stub.js";
import type { OptOutStore } from "../src/outreach/opt-out-store.js";
import type { OutreachControlStore } from "../src/outreach/outreach-control-store.js";
import type { EmailAccountsStore, EmailAccountState } from "../src/db/hartwich-os/email-accounts-store.js";
import { SendFollowUpsPipeline } from "../src/pipelines/send-followups.js";

const NOW = new Date("2026-01-10T16:00:00Z"); // Saturday — outside the default Mon-Fri window on purpose for one test
const WEEKDAY_NOW = new Date("2026-01-07T16:00:00Z"); // Wed 10am Winnipeg

function daysAgo(base: Date, n: number): Date {
  return new Date(base.getTime() - n * 24 * 60 * 60 * 1000);
}

const DUE_CANDIDATE: FollowUpCandidateTarget = {
  dealId: "33333333-3333-4333-8333-333333333333",
  companyId: "11111111-1111-4111-8111-111111111111",
  company: { name: "Example HVAC Co.", website: null },
  contact: { id: "22222222-2222-4222-8222-222222222222", name: null, title: null, email: "info@example-hvac.test" },
  lastOutboundEmailAt: daysAgo(WEEKDAY_NOW, 4),
  lastInboundEmailAt: null,
  followUpCount: 0,
  lastMessage: { subject: "Quick note about your reviews", body: "Hi there, I noticed..." },
};

class FakeGmailSender implements GmailSender {
  sent: SendEmailInput[] = [];
  async send(input: SendEmailInput): Promise<SendEmailResult> {
    this.sent.push(input);
    return { messageId: `msg-${this.sent.length}`, fromAddress: "hartwichlabs@gmail.com", threadId: null };
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
  async isSuppressed() {
    return false;
  }
  async suppress() {}
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

function buildPipeline(candidates: FollowUpCandidateTarget[]) {
  const gmail = new FakeGmailSender();
  const recordStore = new FakeRecordStore();

  const tools = new ToolRegistry()
    .register(createGetFollowUpCandidatesTool(async () => candidates))
    .register(createSendEmailTool(gmail))
    .register(createRecordOutboundEmailTool(recordStore));

  const provider = new FakeModelProvider({
    responsesBySchema: {
      outreach_followup_agent_output: { subject: "Re: Quick note about your reviews", body: "Following up..." },
    },
  });

  const policy = new DefaultPolicyEngine(DEFAULT_POLICY_RULES);
  const runtime = new AgentRuntime({
    modelRouter: new ModelRouter({ fast: provider, strong: provider }),
    tools,
    policy,
    audit: { record: async () => {} },
  });

  const pipeline = new SendFollowUpsPipeline({
    runtime,
    tools,
    policy,
    optOuts: new FakeOptOutStore(),
    control: new FakeControlStore(),
    accounts: new FakeAccountsStore(),
  });

  return { pipeline, gmail, recordStore };
}

describe("SendFollowUpsPipeline", () => {
  it("sends a due follow-up and records it without advancing the stage", async () => {
    const { pipeline, gmail, recordStore } = buildPipeline([DUE_CANDIDATE]);

    const results = await pipeline.runAll(WEEKDAY_NOW);

    expect(results).toHaveLength(1);
    expect(results[0].outcome).toBe("sent");
    expect(gmail.sent).toHaveLength(1);
    expect(recordStore.recorded[0].kind).toBe("follow_up");
  });

  it("skips a candidate that isn't due yet", async () => {
    const notDue: FollowUpCandidateTarget = { ...DUE_CANDIDATE, lastOutboundEmailAt: daysAgo(WEEKDAY_NOW, 1) };
    const { pipeline, gmail } = buildPipeline([notDue]);

    const results = await pipeline.runAll(WEEKDAY_NOW);

    expect(results[0].outcome).toBe("not_due");
    expect(gmail.sent).toHaveLength(0);
  });

  it("skips a candidate that already replied", async () => {
    const replied: FollowUpCandidateTarget = { ...DUE_CANDIDATE, lastInboundEmailAt: daysAgo(WEEKDAY_NOW, 1) };
    const { pipeline, gmail } = buildPipeline([replied]);

    const results = await pipeline.runAll(WEEKDAY_NOW);

    expect(results[0].outcome).toBe("not_due");
    expect(gmail.sent).toHaveLength(0);
  });

  it("defers outside the sending window even if the cadence says due", async () => {
    const { pipeline, gmail } = buildPipeline([DUE_CANDIDATE]);

    const results = await pipeline.runAll(NOW); // Saturday

    expect(results[0].outcome).toBe("deferred");
    expect(gmail.sent).toHaveLength(0);
  });
});
