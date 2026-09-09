/**
 * Phase 2 demo — runs Discovery → Research → Qualification → persist
 * end to end against fixtures (no GOOGLE_PLACES_API_KEY or
 * HARTWICH_DATABASE_URL required), same zero-config philosophy as
 * src/index.ts. Uses real Groq/Anthropic calls only if their API keys are
 * set; otherwise falls back to canned FakeModelProvider responses.
 *
 * Run with: npm run demo:discover
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
import { createSearchGooglePlacesTool } from "./tools/search-google-places.js";
import { createFindDuplicateCompanyTool } from "./tools/find-duplicate-company.js";
import { createFetchWebsiteTextTool } from "./tools/fetch-website-text.js";
import { createPersistDiscoveredCompanyTool } from "./tools/persist-discovered-company.js";
import type { HartwichWriteStore, PersistDiscoveredCompanyInput } from "./db/hartwich-os/write-store.js";
import { DiscoverResearchQualifyPipeline } from "./pipelines/discover-research-qualify.js";

class PrintingWriteStore implements HartwichWriteStore {
  async persistDiscoveredCompany(input: PersistDiscoveredCompanyInput) {
    console.log(`  → would persist "${input.place.name}" as ${input.status} (score ${input.qualificationScore})`);
    return { companyId: `demo-${input.placeId}`, contactId: null, dealId: input.status === "qualified" ? `deal-${input.placeId}` : null };
  }
  async createEmailDraft(): Promise<never> {
    throw new Error("not used by this demo — see demo-outreach.ts for Phase 4");
  }
  async recordOutboundEmail(): Promise<never> {
    throw new Error("not used by this demo — see demo-execute-outreach.ts for Phase 5");
  }
}

const FIXTURE_SEARCH_RESPONSE = {
  places: [
    {
      id: "demo-place-1",
      displayName: { text: "Example HVAC Co." },
      formattedAddress: "123 Main St, Winnipeg, MB",
      nationalPhoneNumber: "204-555-0100",
      websiteUri: "https://example-hvac.test",
      rating: 3.2,
      userRatingCount: 3,
    },
    {
      id: "demo-place-2",
      displayName: { text: "Acme HVAC Supply Warehouse" },
      formattedAddress: "456 Industrial Rd, Winnipeg, MB",
      rating: 4.8,
      userRatingCount: 210,
    },
  ],
};

async function main() {
  process.env.GOOGLE_PLACES_API_KEY ??= "demo-key"; // never actually used — search hits the fixture fetch below

  const fixtureFetch: typeof fetch = (async (url) => {
    if (String(url).includes("places:searchText")) {
      return new Response(JSON.stringify(FIXTURE_SEARCH_RESPONSE), { status: 200 });
    }
    return new Response("<html><body>We fix your HVAC. Call us for service.</body></html>", { status: 200 });
  }) as typeof fetch;

  const tools = new ToolRegistry()
    .register(createSearchGooglePlacesTool(fixtureFetch))
    .register(createFindDuplicateCompanyTool(async () => [])) // fixture: nothing on file yet
    .register(createFetchWebsiteTextTool(fixtureFetch))
    .register(createPersistDiscoveredCompanyTool(new PrintingWriteStore()));

  const fastProvider = process.env.GROQ_API_KEY
    ? new GroqProvider()
    : new FakeModelProvider({
        model: "fake-model (set GROQ_API_KEY for real Groq calls)",
        responsesBySchema: {
          prospect_discovery_agent_output: {
            decisions: [
              { placeId: "demo-place-1", keep: true, reason: "Real HVAC service business." },
              { placeId: "demo-place-2", keep: false, reason: "Supply store, not a service business." },
            ],
          },
          research_agent_output: {
            servicesOffered: ["furnace repair", "AC installation"],
            apparentSize: "small",
            contactName: null,
            contactTitle: null,
            contactEmail: null,
            contactPhone: null,
            contactLinkedinUrl: null,
            summary: "Small local HVAC shop with a basic website and no named contact.",
            salesSignals: [{ signal: "Low review count", evidence: "Only 3 Google reviews." }],
          },
          qualification_agent_output: {
            icpFit: { value: 90, reasoning: "Local HVAC service business — squarely in Hartwich's ICP." },
            opportunity: { value: 85, reasoning: "3 reviews, 3.2★ — clear reputation gap." },
            contactability: { value: 20, reasoning: "No named contact or email found." },
            businessQuality: { value: 60, reasoning: "Has a website listing real services." },
            timing: { value: 50, reasoning: "No specific timing evidence either way." },
            dataConfidence: { value: 70, reasoning: "Places data solid; website content thin." },
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

  const pipeline = new DiscoverResearchQualifyPipeline({ runtime, tools, policy, audit });

  console.log(`Running discovery for "HVAC contractor" in "Winnipeg, MB"...\n`);
  const summary = await pipeline.run({ area: "Winnipeg, MB", keyword: "HVAC contractor" });

  console.log(`\nFound ${summary.found} candidates:`);
  for (const r of summary.results) {
    console.log(`  - ${r.name}: ${r.outcome}${r.score != null ? ` (score ${r.score}, tier ${r.tier})` : ""}`);
  }
  console.log(`\n${audit.records.length} audit records written.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
