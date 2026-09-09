/**
 * Phase 5 demo — autonomous cold-outreach send, end to end against
 * fixtures (no HARTWICH_DATABASE_URL/GOOGLE creds needed): the send guard
 * (opt-out, kill switch, sending window, warm-up) actually runs, and a
 * fake Gmail sender stands in for the real API call. No approval step —
 * this is the point.
 *
 * Run with: npm run demo:execute-outreach
 */
import "dotenv/config";
import { AgentRuntime } from "./runtime/agent-runtime.js";
import { ModelRouter } from "./runtime/model-router.js";
import { FakeModelProvider } from "./runtime/model-providers/fake.js";
import { ToolRegistry } from "./runtime/tool-registry.js";
import { DefaultPolicyEngine } from "./runtime/policy-engine.js";
import { DEFAULT_POLICY_RULES } from "./policy/default-rules.js";
import { createGetOutreachTargetTool, type OutreachTarget } from "./tools/get-outreach-target.js";
import { createSendEmailTool } from "./tools/send-email.js";
import { createRecordOutboundEmailTool } from "./tools/record-outbound-email.js";
import type { GmailSender, SendEmailInput, SendEmailResult } from "./integrations/gmail.js";
import type { RecordOutboundEmailInput } from "./db/hartwich-os/write-store.js";
import { NotImplementedWriteStore } from "./db/hartwich-os/write-store-stub.js";
import type { OptOutStore } from "./outreach/opt-out-store.js";
import type { OutreachControlStore } from "./outreach/outreach-control-store.js";
import type { EmailAccountsStore, EmailAccountState } from "./db/hartwich-os/email-accounts-store.js";
import { ExecuteOutreachPipeline } from "./pipelines/execute-outreach.js";

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
    qualificationReasoning: "Only 3 reviews and a 3.2★ rating.",
    websiteSummary: "Small local HVAC shop.",
    servicesOffered: ["furnace repair", "AC installation"],
    apparentSize: "small",
    notes: null,
  },
  contact: { id: "22222222-2222-4222-8222-222222222222", name: null, title: null, email: "info@example-hvac.test" },
  dealId: "33333333-3333-4333-8333-333333333333",
  dealStageName: "New Lead",
};

class PrintingGmailSender implements GmailSender {
  async send(input: SendEmailInput): Promise<SendEmailResult> {
    console.log(`\n  → SENDING (account ${input.accountIndex}) to ${input.to}:`);
    console.log(`    Subject: ${input.subject}`);
    console.log(`    Body: ${input.body}`);
    return { messageId: "demo-msg-1", fromAddress: "hartwichlabs@gmail.com", threadId: "demo-thread-1" };
  }
}

class PrintingRecordStore extends NotImplementedWriteStore {
  async recordOutboundEmail(_input: RecordOutboundEmailInput) {
    console.log(`\n  → would record this as a hartwich-os activity/message and move the deal to "Contacted".`);
    return { activityId: "demo-activity-1", messageId: "demo-message-1" };
  }
}

class NoOptOuts implements OptOutStore {
  async isSuppressed() {
    return false;
  }
  async suppress() {}
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
  async recordSend(accountIndex: 0 | 1 | 2) {
    console.log(`  → would record a send against account ${accountIndex}'s daily warm-up count.`);
  }
}

async function main() {
  const tools = new ToolRegistry()
    .register(createGetOutreachTargetTool(async () => TARGET))
    .register(createSendEmailTool(new PrintingGmailSender()))
    .register(createRecordOutboundEmailTool(new PrintingRecordStore()));

  const provider = new FakeModelProvider({
    responsesBySchema: {
      outreach_strategy_agent_output: {
        channel: "email",
        angle: "Low review count for a business this established-looking.",
        hook: "Only 3 Google reviews at a 3.2★ rating.",
        personalizationPoints: ["Located in Winnipeg, MB", "Offers furnace repair and AC installation"],
        cta: "a quick call",
        reasoning: "Clear, evidence-backed reputation-infrastructure gap.",
      },
      outreach_generation_agent_output: {
        initial: {
          subject: "Quick note about your reviews",
          body: "Hi there,\n\nI noticed Example HVAC Co. is sitting at 3.2 stars with just 3 Google reviews. Hartwich Labs helps HVAC businesses fix exactly that. Worth a quick call?\n\nBest,\nGavin",
        },
        followUps: [],
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

  const pipeline = new ExecuteOutreachPipeline({
    runtime,
    tools,
    policy,
    optOuts: new NoOptOuts(),
    control: new NotPaused(),
    accounts: new FreshAccounts(),
  });

  const result = await pipeline.run(COMPANY_ID, undefined, WEEKDAY_BUSINESS_HOURS);
  console.log(`\nOutcome: ${result.outcome}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
