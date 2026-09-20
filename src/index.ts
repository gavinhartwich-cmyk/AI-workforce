/**
 * Phase 1 demo — proves the runtime pipeline end to end:
 *   input → reason (Groq, or a canned fake if GROQ_API_KEY isn't set) →
 *   structured output → policy check → get_company tool call → audit.
 *
 * Run with: npm run demo:company-lookup
 */
import "dotenv/config";
import { AgentRuntime } from "./runtime/agent-runtime.js";
import { ModelRouter } from "./runtime/model-router.js";
import { GroqProvider } from "./runtime/model-providers/groq.js";
import { FakeModelProvider } from "./runtime/model-providers/fake.js";
import { AnthropicProvider } from "./runtime/model-providers/anthropic.js";
import { ToolRegistry } from "./runtime/tool-registry.js";
import { DefaultPolicyEngine } from "./runtime/policy-engine.js";
import { InMemoryAuditSink } from "./runtime/audit-sink.js";
import { createGetCompanyTool, type CompanyRecord } from "./tools/get-company.js";
import { companyReviewAgent } from "./agents/company-review-agent.js";

async function main() {
  const demoCompanyId = "11111111-1111-4111-8111-111111111111";

  // No HARTWICH_DATABASE_URL required for this demo — a fixture stands in
  // for hartwich-os's `companies` table so the pipeline is runnable with
  // zero configuration. Point HARTWICH_DATABASE_URL at hartwich-os's real
  // Postgres (and drop the `lookup` override below) to use real CRM data.
  const fixture: CompanyRecord = {
    id: demoCompanyId,
    name: "Example HVAC Co.",
    website: "https://example-hvac.test",
    city: "Winnipeg",
    state: "MB",
    googleReviewCount: 3,
    googleRating: "3.20",
    qualificationScore: null,
    qualificationReasoning: null,
    status: "needs_review",
  };
  const getCompanyTool = createGetCompanyTool(async (id) => (id === demoCompanyId ? fixture : null));

  const fastProvider = process.env.GROQ_API_KEY
    ? new GroqProvider()
    : new FakeModelProvider({
        model: "fake-model (set GROQ_API_KEY for a real Groq call)",
        structuredResponse: {
          assessment:
            "Surfaced for a low review count — pulling the CRM record would help confirm the qualification signal.",
          needsCompanyRecord: true,
          toolCalls: [{ tool: "get_company", input: { companyId: demoCompanyId } }],
        },
      });

  // Wired up but unused by this demo (companyReviewAgent runs on the "fast"
  // lane) — proves the "strong" lane resolves to a real provider now that
  // Claude usage is unblocked, without spending on a call this demo doesn't need.
  const strongProvider = process.env.ANTHROPIC_API_KEY ? new AnthropicProvider() : fastProvider;

  const runtime = new AgentRuntime({
    modelRouter: new ModelRouter({ fast: fastProvider, strong: strongProvider }),
    tools: new ToolRegistry().register(getCompanyTool),
    // get_company is read-only, so companyReviewAgent's autonomy level 0
    // clears policy with zero rules configured — see DefaultPolicyEngine.
    policy: new DefaultPolicyEngine([]),
    audit: new InMemoryAuditSink(),
  });

  const result = await runtime.run(companyReviewAgent, {
    companyId: demoCompanyId,
    reason: "Google Places discovery flagged this lead with only 3 reviews and a 3.2★ rating.",
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
