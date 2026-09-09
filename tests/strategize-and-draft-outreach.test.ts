import { describe, expect, it } from "vitest";
import { AgentRuntime } from "../src/runtime/agent-runtime.js";
import { ModelRouter } from "../src/runtime/model-router.js";
import { FakeModelProvider } from "../src/runtime/model-providers/fake.js";
import { ToolRegistry } from "../src/runtime/tool-registry.js";
import { DefaultPolicyEngine } from "../src/runtime/policy-engine.js";
import { InMemoryAuditSink } from "../src/runtime/audit-sink.js";
import { DEFAULT_POLICY_RULES } from "../src/policy/default-rules.js";
import { createGetOutreachTargetTool, type OutreachTarget } from "../src/tools/get-outreach-target.js";
import { createCreateEmailDraftTool } from "../src/tools/create-email-draft.js";
import type { HartwichWriteStore, CreateEmailDraftInput } from "../src/db/hartwich-os/write-store.js";
import { StrategizeAndDraftOutreachPipeline } from "../src/pipelines/strategize-and-draft-outreach.js";
import type { Experiment } from "../src/experiments/types.js";

const TARGET: OutreachTarget = {
  company: {
    id: "11111111-1111-4111-8111-111111111111",
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

class FakeDraftStore implements HartwichWriteStore {
  drafts: CreateEmailDraftInput[] = [];
  async persistDiscoveredCompany(): Promise<never> {
    throw new Error("not used by this test");
  }
  async createEmailDraft(input: CreateEmailDraftInput) {
    this.drafts.push(input);
    return { draftId: `draft-${this.drafts.length}` };
  }
  async recordOutboundEmail(): Promise<never> {
    throw new Error("not used by this test — see tests/execute-outreach.test.ts for Phase 5");
  }
}

const STRATEGY_RESPONSE = {
  channel: "email",
  angle: "Low review count relative to the size of the business.",
  hook: "Only 3 Google reviews at 3.2 stars.",
  personalizationPoints: ["Located in Winnipeg, MB", "Offers furnace repair"],
  cta: "a quick call",
  reasoning: "Clear reputation-infrastructure gap.",
};

const GENERATION_RESPONSE = {
  initial: { subject: "Quick question about your reviews", body: "Hi there, I noticed..." },
  followUps: [
    { followUpNumber: 1, subject: "Re: Quick question about your reviews", body: "Following up..." },
    { followUpNumber: 2, subject: "Re: Quick question about your reviews", body: "One more bump..." },
  ],
};

function buildPipeline(opts: { target: OutreachTarget | null; draftStore: HartwichWriteStore }) {
  const tools = new ToolRegistry()
    .register(createGetOutreachTargetTool(async () => opts.target))
    .register(createCreateEmailDraftTool(opts.draftStore));

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
    audit: new InMemoryAuditSink(),
  });

  return new StrategizeAndDraftOutreachPipeline({ runtime, tools, policy });
}

describe("StrategizeAndDraftOutreachPipeline", () => {
  it("strategizes, generates, and drafts a pending-review email end to end", async () => {
    const draftStore = new FakeDraftStore();
    const pipeline = buildPipeline({ target: TARGET, draftStore });

    const result = await pipeline.run("11111111-1111-4111-8111-111111111111");

    expect(result.outcome).toBe("drafted");
    if (result.outcome !== "drafted") throw new Error("unreachable");
    expect(result.draftId).toBe("draft-1");

    expect(draftStore.drafts).toHaveLength(1);
    expect(draftStore.drafts[0].subject).toBe(GENERATION_RESPONSE.initial.subject);
    expect(draftStore.drafts[0].kind).toBe("cold_outreach");
    expect(draftStore.drafts[0].companyId).toBe("11111111-1111-4111-8111-111111111111");
    expect(draftStore.drafts[0].contactId).toBe("22222222-2222-4222-8222-222222222222");
    // Only the initial message is persisted — follow-ups wait for Phase 5.
    expect(draftStore.drafts).toHaveLength(1);
  });

  it("skips a prospect with no contact email rather than drafting to nobody", async () => {
    const draftStore = new FakeDraftStore();
    const noEmailTarget: OutreachTarget = { ...TARGET, contact: { id: "c", name: null, title: null, email: null } };
    const pipeline = buildPipeline({ target: noEmailTarget, draftStore });

    const result = await pipeline.run("11111111-1111-4111-8111-111111111111");

    expect(result.outcome).toBe("no_contact");
    expect(draftStore.drafts).toHaveLength(0);
  });

  it("threads an experiment's assigned variant directive into the strategy agent", async () => {
    const draftStore = new FakeDraftStore();

    // A provider that asserts the experiment directive actually reached
    // the strategy prompt, by inspecting the user message it was given.
    const assertingProvider = new FakeModelProvider({
      responsesBySchema: {
        outreach_strategy_agent_output: STRATEGY_RESPONSE,
        outreach_generation_agent_output: GENERATION_RESPONSE,
      },
    });
    const originalStructuredGenerate = assertingProvider.structuredGenerate.bind(assertingProvider);
    let sawDirective = false;
    assertingProvider.structuredGenerate = async (input) => {
      if (input.schemaName === "outreach_strategy_agent_output") {
        sawDirective = input.messages.some((m) => m.content.includes("Lead with the rating gap"));
      }
      return originalStructuredGenerate(input);
    };

    const tools = new ToolRegistry()
      .register(createGetOutreachTargetTool(async () => TARGET))
      .register(createCreateEmailDraftTool(draftStore));
    const policy = new DefaultPolicyEngine(DEFAULT_POLICY_RULES);
    const runtime = new AgentRuntime({
      modelRouter: new ModelRouter({ fast: assertingProvider, strong: assertingProvider }),
      tools,
      policy,
      audit: new InMemoryAuditSink(),
    });
    const pipeline = new StrategizeAndDraftOutreachPipeline({ runtime, tools, policy });

    const experiment: Experiment = {
      id: "exp-angle-test",
      name: "Angle test",
      description: "Reviews vs. rating angle",
      minSampleSizePerVariant: 30,
      status: "running",
      createdAt: new Date(),
      variants: [{ id: "rating-angle", name: "Rating angle", directive: "Lead with the rating gap.", weight: 1 }],
    };

    const result = await pipeline.run("11111111-1111-4111-8111-111111111111", experiment);

    expect(result.outcome).toBe("drafted");
    if (result.outcome !== "drafted") throw new Error("unreachable");
    expect(result.variantId).toBe("rating-angle");
    expect(sawDirective).toBe(true);
  });
});
