import { describe, expect, it } from "vitest";
import { AgentRuntime } from "../src/runtime/agent-runtime.js";
import { ModelRouter } from "../src/runtime/model-router.js";
import { FakeModelProvider } from "../src/runtime/model-providers/fake.js";
import { ToolRegistry } from "../src/runtime/tool-registry.js";
import { DefaultPolicyEngine } from "../src/runtime/policy-engine.js";
import { InMemoryAuditSink } from "../src/runtime/audit-sink.js";
import { DEFAULT_POLICY_RULES } from "../src/policy/default-rules.js";
import { createSearchGooglePlacesTool, type PlaceCandidate } from "../src/tools/search-google-places.js";
import { createFindDuplicateCompanyTool } from "../src/tools/find-duplicate-company.js";
import { createFetchWebsiteTextTool } from "../src/tools/fetch-website-text.js";
import { createPersistDiscoveredCompanyTool } from "../src/tools/persist-discovered-company.js";
import type { HartwichWriteStore, PersistDiscoveredCompanyInput } from "../src/db/hartwich-os/write-store.js";
import { NotImplementedWriteStore } from "../src/db/hartwich-os/write-store-stub.js";
import { DiscoverResearchQualifyPipeline } from "../src/pipelines/discover-research-qualify.js";

const PLACES: PlaceCandidate[] = [
  {
    placeId: "place-hvac-co",
    name: "Example HVAC Co.",
    address: "123 Main St, Winnipeg, MB",
    phone: "204-555-0100",
    website: "https://example-hvac.test",
    rating: 3.2,
    userRatingCount: 3,
  },
  {
    placeId: "place-supply-store",
    name: "Acme HVAC Supply Warehouse",
    address: "456 Industrial Rd, Winnipeg, MB",
    phone: null,
    website: null,
    rating: 4.8,
    userRatingCount: 40, // under MAX_GOOGLE_REVIEW_COUNT, so the AGENT filter is what rejects it here
  },
];

/** Fake Google Places response carrying our fixed candidate list. */
const searchFetchFake: typeof fetch = (async () =>
  new Response(
    JSON.stringify({
      places: PLACES.map((p) => ({
        id: p.placeId,
        displayName: { text: p.name },
        formattedAddress: p.address,
        nationalPhoneNumber: p.phone,
        websiteUri: p.website,
        rating: p.rating,
        userRatingCount: p.userRatingCount,
      })),
    }),
    { status: 200 }
  )) as typeof fetch;

const websiteFetchFake: typeof fetch = (async () =>
  new Response("<html><body>We fix your HVAC. Contact us.</body></html>", { status: 200 })) as typeof fetch;

/** In-memory fake standing in for hartwich-os's Postgres — captures every persisted lead. */
class FakeWriteStore extends NotImplementedWriteStore {
  readonly persisted: PersistDiscoveredCompanyInput[] = [];
  async persistDiscoveredCompany(input: PersistDiscoveredCompanyInput) {
    this.persisted.push(input);
    return {
      companyId: `company-${this.persisted.length}`,
      contactId: input.enrichment?.contactEmail ? `contact-${this.persisted.length}` : null,
      dealId: input.status === "qualified" ? `deal-${this.persisted.length}` : null,
    };
  }
}

function buildPipeline(opts: { writeStore: HartwichWriteStore; existingCompanies?: { id: string; name: string; website: string | null }[]; maxGoogleReviewCount?: number }) {
  process.env.GOOGLE_PLACES_API_KEY = "test-key"; // required by the tool's own guard, never actually hits the network here

  const tools = new ToolRegistry()
    .register(createSearchGooglePlacesTool(searchFetchFake))
    .register(createFindDuplicateCompanyTool(async () => opts.existingCompanies ?? []))
    .register(createFetchWebsiteTextTool(websiteFetchFake))
    .register(createPersistDiscoveredCompanyTool(opts.writeStore));

  const provider = new FakeModelProvider({
    responsesBySchema: {
      prospect_discovery_agent_output: {
        decisions: PLACES.map((p) => ({
          placeId: p.placeId,
          keep: p.placeId === "place-hvac-co", // filter out the supply store
          reason:
            p.placeId === "place-hvac-co" ? "Real HVAC service business." : "Supply store, not a service business.",
        })),
      },
      // Research and qualification arrive together now — one call per
      // candidate instead of a chain that re-sent the research back in.
      prospect_assessment_agent_output: {
        servicesOffered: ["furnace repair", "AC installation"],
        apparentSize: "small",
        contactName: null,
        contactTitle: null,
        contactEmail: null,
        contactPhone: null,
        contactLinkedinUrl: null,
        summary: "Small local HVAC shop with a basic website.",
        salesSignals: [{ signal: "Low review count", evidence: "Only 3 Google reviews." }],
        assessment: {
          icpFit: { value: 90, reasoning: "Local HVAC service business, small size — squarely in Hartwich's ICP." },
          opportunity: { value: 85, reasoning: "3 reviews and 3.2 stars — clear reputation-infrastructure gap." },
          contactability: { value: 20, reasoning: "No named contact or email found." },
          businessQuality: { value: 60, reasoning: "Has a website listing real services." },
          timing: { value: 50, reasoning: "No specific timing evidence either way." },
          dataConfidence: { value: 70, reasoning: "Places data is solid; website content was thin." },
        },
      },
    },
  });

  const audit = new InMemoryAuditSink();
  const policy = new DefaultPolicyEngine(DEFAULT_POLICY_RULES);
  const runtime = new AgentRuntime({
    modelRouter: new ModelRouter({ fast: provider, strong: provider }),
    tools,
    policy,
    audit,
  });

  return {
    pipeline: new DiscoverResearchQualifyPipeline({ runtime, tools, policy, audit, maxGoogleReviewCount: opts.maxGoogleReviewCount }),
    audit,
  };
}

describe("DiscoverResearchQualifyPipeline", () => {
  it("filters, researches, qualifies, and persists a lead end to end", async () => {
    const writeStore = new FakeWriteStore();
    const { pipeline, audit } = buildPipeline({ writeStore });

    const summary = await pipeline.run({ area: "Winnipeg, MB", keyword: "HVAC contractor" });

    expect(summary.found).toBe(2);
    expect(summary.results).toHaveLength(2);

    const supplyStore = summary.results.find((r) => r.placeId === "place-supply-store");
    expect(supplyStore?.outcome).toBe("filtered_out");

    // Weighted: 90*.30 + 85*.25 + 20*.15 + 60*.15 + 50*.10 + 70*.05 = 68.75 → 69, at/above the 60 auto-file threshold.
    const hvacCo = summary.results.find((r) => r.placeId === "place-hvac-co");
    expect(hvacCo?.outcome).toBe("qualified");
    expect(hvacCo?.score).toBe(69);
    expect(hvacCo?.tier).toBe("B");
    expect(hvacCo?.companyId).toBe("company-1");

    expect(writeStore.persisted).toHaveLength(1);
    expect(writeStore.persisted[0].place.name).toBe("Example HVAC Co.");
    expect(writeStore.persisted[0].status).toBe("qualified");

    // The deterministic persist step gets its own audit record, separate
    // from the three LLM agent runs (which each recorded their own).
    const persistRecords = audit.records.filter((r) => r.agentId === "discovery_pipeline");
    expect(persistRecords).toHaveLength(1);
    expect(persistRecords[0].status).toBe("succeeded");
    expect(persistRecords[0].model).toBe("n/a");

    const llmRecords = audit.records.filter((r) => r.agentId !== "discovery_pipeline");
    expect(llmRecords.map((r) => r.agentId).sort()).toEqual(
      ["prospect_discovery_agent", "prospect_assessment_agent"].sort()
    );
  });

  it("skips a candidate that's already a duplicate, without persisting anything", async () => {
    const writeStore = new FakeWriteStore();
    const { pipeline } = buildPipeline({
      writeStore,
      existingCompanies: [{ id: "existing-1", name: "Example HVAC Co.", website: "https://example-hvac.test" }],
    });

    const summary = await pipeline.run({ area: "Winnipeg, MB", keyword: "HVAC contractor" });

    const hvacCo = summary.results.find((r) => r.placeId === "place-hvac-co");
    expect(hvacCo?.outcome).toBe("duplicate");
    expect(writeStore.persisted).toHaveLength(0);
  });

  it("drops a business above the ICP review ceiling before any LLM call", async () => {
    // Hartwich Labs sells review automation — a business already holding
    // hundreds of reviews has solved that problem and is not a prospect,
    // however good a business it is. Gavin saw one with 300 reviews scored
    // 75/100, because review volume reads as "quality" to the model.
    const writeStore = new FakeWriteStore();
    const { pipeline, audit } = buildPipeline({ writeStore, maxGoogleReviewCount: 20 });

    const summary = await pipeline.run({ area: "Winnipeg, MB", keyword: "HVAC contractor" });

    const tooBig = summary.results.find((r) => r.placeId === "place-supply-store");
    expect(tooBig?.outcome).toBe("too_many_reviews");
    expect(tooBig?.reviewCount).toBe(40);
    expect(writeStore.persisted.some((p) => p.place.name === "Acme HVAC Supply Warehouse")).toBe(false);

    // Researched exactly once — for the surviving 3-review company, not the
    // one over the ceiling. That's the point: an out-of-ICP business costs
    // zero research/qualification tokens.
    const researchRuns = audit.records.filter((r) => r.agentId === "prospect_assessment_agent");
    expect(researchRuns).toHaveLength(1);

    // `found` still reports what the search returned, not what survived.
    expect(summary.found).toBe(2);
  });
});
