/**
 * Phase 4 demo — Strategy → Generation → pending-review draft, end to end
 * against a fixture (no HARTWICH_DATABASE_URL needed). Also shows an
 * experiment directive reaching the Strategy Agent's prompt.
 *
 * Run with: npm run demo:outreach
 */
import "dotenv/config";
import { AgentRuntime } from "./runtime/agent-runtime.js";
import { ModelRouter } from "./runtime/model-router.js";
import { GroqProvider } from "./runtime/model-providers/groq.js";
import { FakeModelProvider } from "./runtime/model-providers/fake.js";
import { ToolRegistry } from "./runtime/tool-registry.js";
import { DefaultPolicyEngine } from "./runtime/policy-engine.js";
import { InMemoryAuditSink } from "./runtime/audit-sink.js";
import { DEFAULT_POLICY_RULES } from "./policy/default-rules.js";
import { createGetOutreachTargetTool, type OutreachTarget } from "./tools/get-outreach-target.js";
import { createCreateEmailDraftTool } from "./tools/create-email-draft.js";
import type { HartwichWriteStore, CreateEmailDraftInput, PersistDiscoveredCompanyInput } from "./db/hartwich-os/write-store.js";
import { StrategizeAndDraftOutreachPipeline } from "./pipelines/strategize-and-draft-outreach.js";
import { assignVariant } from "./experiments/assignment.js";
import type { Experiment } from "./experiments/types.js";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";

const FIXTURE_TARGET: OutreachTarget = {
  company: {
    id: COMPANY_ID,
    name: "Example HVAC Co.",
    website: "https://example-hvac.test",
    city: "Winnipeg",
    state: "MB",
    googleReviewCount: 3,
    googleRating: "3.20",
    qualificationScore: 69,
    qualificationReasoning: "Only 3 reviews and a 3.2★ rating — clear reputation-infrastructure gap.",
    websiteSummary: "Small local HVAC shop offering furnace repair and AC installation.",
    servicesOffered: ["furnace repair", "AC installation"],
    apparentSize: "small",
    notes: null,
  },
  contact: { id: "22222222-2222-4222-8222-222222222222", name: null, title: null, email: "info@example-hvac.test" },
  dealId: "33333333-3333-4333-8333-333333333333",
  dealStageName: "New Lead",
};

class PrintingDraftStore implements HartwichWriteStore {
  async persistDiscoveredCompany(input: PersistDiscoveredCompanyInput): Promise<never> {
    void input;
    throw new Error("not used by this demo — see demo-discover.ts for Phase 2");
  }
  async createEmailDraft(input: CreateEmailDraftInput) {
    console.log(`\n  → would create a "${input.kind}" draft (pending_review) in hartwich-os:`);
    console.log(`    Subject: ${input.subject}`);
    console.log(`    Body: ${input.body}`);
    return { draftId: "demo-draft-1" };
  }
  async recordOutboundEmail(): Promise<never> {
    throw new Error("not used by this demo — see demo-execute-outreach.ts for Phase 5");
  }
}

async function main() {
  const tools = new ToolRegistry()
    .register(createGetOutreachTargetTool(async () => FIXTURE_TARGET))
    .register(createCreateEmailDraftTool(new PrintingDraftStore()));

  const fastProvider = process.env.GROQ_API_KEY
    ? new GroqProvider()
    : new FakeModelProvider({
        model: "fake-model (set GROQ_API_KEY for real Groq calls)",
        responsesBySchema: {
          outreach_strategy_agent_output: {
            channel: "email",
            angle: "Low review count for a business this established-looking.",
            hook: "Only 3 Google reviews at a 3.2★ rating.",
            personalizationPoints: ["Located in Winnipeg, MB", "Offers furnace repair and AC installation"],
            cta: "a quick call",
            reasoning: "Clear, evidence-backed reputation-infrastructure gap — a strong fit for the offer.",
          },
          outreach_generation_agent_output: {
            initial: {
              subject: "Quick note about your reviews",
              body: "Hi there,\n\nI came across Example HVAC Co. and noticed you're sitting at 3.2 stars with just 3 Google reviews — for a shop offering furnace repair and AC installation, that's likely costing you calls to competitors with a bigger review presence.\n\nHartwich Labs helps HVAC businesses like yours systematically request and manage Google reviews. Worth a quick call to see if it's a fit?\n\nBest,\nGavin",
            },
            followUps: [
              {
                followUpNumber: 1,
                subject: "Re: Quick note about your reviews",
                body: "Wanted to bump this up in case it got buried — still happy to grab 10 minutes if useful.",
              },
            ],
          },
        },
      });

  const audit = new InMemoryAuditSink();
  const policy = new DefaultPolicyEngine(DEFAULT_POLICY_RULES);
  const runtime = new AgentRuntime({
    modelRouter: new ModelRouter({ fast: fastProvider, strong: fastProvider }),
    tools,
    policy,
    audit,
  });

  const pipeline = new StrategizeAndDraftOutreachPipeline({ runtime, tools, policy });

  // Shows the experiment-directive path without needing a live database —
  // src/experiments/experiment-store.ts is what persists this for real.
  const experiment: Experiment = {
    id: "demo-angle-experiment",
    name: "Review-count vs. rating angle",
    description: "Which opening angle gets more replies?",
    minSampleSizePerVariant: 30,
    status: "running",
    createdAt: new Date(),
    variants: [
      { id: "review-count", name: "Review count angle", directive: "Lead with the low review COUNT.", weight: 1 },
      { id: "rating", name: "Rating angle", directive: "Lead with the low star RATING.", weight: 1 },
    ],
  };
  const assigned = assignVariant(experiment, COMPANY_ID);
  console.log(`Assigned experiment variant: "${assigned.name}" (${assigned.directive})`);

  const result = await pipeline.run(COMPANY_ID, experiment);
  console.log(`\nOutcome: ${result.outcome}`);
  console.log(`\n${audit.records.length} audit records written.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
