import { randomUUID } from "node:crypto";
import { AgentRuntime } from "../runtime/agent-runtime.js";
import { ToolExecutor } from "../runtime/tool-executor.js";
import { ToolRegistry } from "../runtime/tool-registry.js";
import type { AuditSink, PolicyEngine } from "../runtime/types.js";
import { AUTONOMY } from "../runtime/autonomy-levels.js";
import { prospectDiscoveryAgent } from "../agents/prospect-discovery-agent.js";
import { researchAgent } from "../agents/research-agent.js";
import { qualificationAgent } from "../agents/qualification-agent.js";
import {
  computeQualificationScore,
  DEFAULT_QUALIFICATION_CONFIG,
  type QualificationConfig,
} from "../qualification/scoring.js";
import type { PlaceCandidate } from "../tools/search-google-places.js";

/**
 * Phase 2's end-to-end pipeline (SPEC.md §55 Phase 2): Discovery → Research
 * → Qualification → persist into hartwich-os. Every step is either a
 * policy-gated tool call or a full AgentRuntime.run() — this class is pure
 * orchestration, no infrastructure of its own (SPEC.md §41's rule for
 * agents applies just as much to the thing wiring them together).
 *
 * All four Phase 2 tools (search_google_places, find_duplicate_company,
 * fetch_website_text, persist_discovered_company) must already be
 * registered on `tools`; this pipeline doesn't construct them itself so
 * tests can inject fakes for every external dependency (Google Places,
 * hartwich-os's database, the target website).
 */

export type DiscoverResearchQualifyInput = {
  area: string;
  keyword: string;
  maxResults?: number;
  /** Franchise/brand names or other ICP exclusions — see lead_sources_config in hartwich-os for the config shape this mirrors. */
  exclusions?: string[];
};

export type PipelineCompanyResult = {
  placeId: string;
  name: string;
  outcome: "qualified" | "needs_review" | "disqualified" | "filtered_out" | "duplicate" | "error";
  score?: number;
  tier?: string;
  companyId?: string;
  error?: string;
};

export type PipelineSummary = {
  found: number;
  results: PipelineCompanyResult[];
};

export class DiscoverResearchQualifyPipeline {
  private toolExecutor: ToolExecutor;

  constructor(
    private deps: {
      runtime: AgentRuntime;
      tools: ToolRegistry;
      policy: PolicyEngine;
      audit: AuditSink;
      qualificationConfig?: QualificationConfig;
    }
  ) {
    this.toolExecutor = new ToolExecutor({ tools: deps.tools, policy: deps.policy });
  }

  async run(input: DiscoverResearchQualifyInput): Promise<PipelineSummary> {
    const exclusions = input.exclusions ?? [];

    const searchResult = await this.invokeTool("search_google_places", {
      area: input.area,
      keyword: input.keyword,
      maxResults: input.maxResults ?? 20,
    });
    if (searchResult.status !== "succeeded") {
      throw new Error(
        `search_google_places ${searchResult.status}: ${
          searchResult.status === "denied" ? searchResult.reason : searchResult.error
        }`
      );
    }
    const candidates = searchResult.output as PlaceCandidate[];
    const results: PipelineCompanyResult[] = [];
    if (candidates.length === 0) return { found: 0, results };

    const discoveryRun = await this.deps.runtime.run(prospectDiscoveryAgent, {
      area: input.area,
      keyword: input.keyword,
      candidates,
      exclusions,
    });
    if (discoveryRun.status !== "succeeded") {
      throw new Error(
        `Prospect Discovery Agent ${discoveryRun.status}: ${
          discoveryRun.status === "denied" ? discoveryRun.reason : discoveryRun.error
        }`
      );
    }
    const keepMap = new Map(discoveryRun.output.decisions.map((d) => [d.placeId, d]));

    for (const candidate of candidates) {
      const decision = keepMap.get(candidate.placeId);
      if (!decision || !decision.keep) {
        results.push({ placeId: candidate.placeId, name: candidate.name, outcome: "filtered_out" });
        continue;
      }

      try {
        results.push(await this.processCandidate(candidate));
      } catch (err) {
        results.push({
          placeId: candidate.placeId,
          name: candidate.name,
          outcome: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { found: candidates.length, results };
  }

  private async processCandidate(candidate: PlaceCandidate): Promise<PipelineCompanyResult> {
    const dedupeResult = await this.invokeTool("find_duplicate_company", {
      name: candidate.name,
      website: candidate.website,
    });
    if (dedupeResult.status !== "succeeded") {
      throw new Error(
        `find_duplicate_company ${dedupeResult.status}: ${
          dedupeResult.status === "denied" ? dedupeResult.reason : dedupeResult.error
        }`
      );
    }
    if ((dedupeResult.output as { duplicate: boolean }).duplicate) {
      return { placeId: candidate.placeId, name: candidate.name, outcome: "duplicate" };
    }

    // A failed/denied website fetch isn't fatal — research still runs on
    // Places data alone, same fail-open behavior as hartwich-os's own
    // enrichCompanyFromWebsite.
    let websiteText: string | null = null;
    let fallbackEmail: string | null = null;
    if (candidate.website) {
      const fetchResult = await this.invokeTool("fetch_website_text", { website: candidate.website });
      if (fetchResult.status === "succeeded") {
        const output = fetchResult.output as { text: string | null; fallbackEmail: string | null };
        websiteText = output.text;
        fallbackEmail = output.fallbackEmail;
      }
    }

    const researchRun = await this.deps.runtime.run(researchAgent, { place: candidate, websiteText });
    if (researchRun.status !== "succeeded") {
      throw new Error(
        `Research Agent ${researchRun.status}: ${researchRun.status === "denied" ? researchRun.reason : researchRun.error}`
      );
    }
    const research = researchRun.output;

    const qualificationRun = await this.deps.runtime.run(qualificationAgent, { place: candidate, research });
    if (qualificationRun.status !== "succeeded") {
      throw new Error(
        `Qualification Agent ${qualificationRun.status}: ${
          qualificationRun.status === "denied" ? qualificationRun.reason : qualificationRun.error
        }`
      );
    }
    const subscores = qualificationRun.output;

    // The deterministic step (SPEC.md §10/§25) — the model above never sees
    // or sets this formula.
    const { score, tier, status } = computeQualificationScore(
      {
        icpFit: subscores.icpFit.value,
        opportunity: subscores.opportunity.value,
        contactability: subscores.contactability.value,
        businessQuality: subscores.businessQuality.value,
        timing: subscores.timing.value,
        dataConfidence: subscores.dataConfidence.value,
      },
      this.deps.qualificationConfig ?? DEFAULT_QUALIFICATION_CONFIG
    );

    const reasoning = (
      [
        ["ICP fit", subscores.icpFit],
        ["Opportunity", subscores.opportunity],
        ["Contactability", subscores.contactability],
        ["Business quality", subscores.businessQuality],
        ["Timing", subscores.timing],
        ["Data confidence", subscores.dataConfidence],
      ] as const
    )
      .map(([label, s]) => `${label} (${s.value}): ${s.reasoning}`)
      .join("\n");

    const contactEmail = research.contactEmail || fallbackEmail || null;

    const persistInput = {
      place: {
        name: candidate.name,
        address: candidate.address,
        phone: candidate.phone,
        website: candidate.website,
        rating: candidate.rating,
        userRatingCount: candidate.userRatingCount,
      },
      placeId: candidate.placeId,
      status,
      qualificationScore: score,
      qualificationReasoning: reasoning,
      // Phase 2 doesn't assign an A/B/C contact tier yet — a deliberate,
      // documented gap (GAP_ANALYSIS.md §3 #8), not an oversight; hartwich-os's
      // own qualifyLead leaves this null today too.
      contactTier: null,
      isOwnerOperated: null,
      isFranchise: false,
      disqualifyReason: status === "disqualified" ? reasoning : null,
      enrichment: {
        summary: research.summary,
        servicesOffered: research.servicesOffered,
        apparentSize: research.apparentSize,
        contactName: research.contactName,
        contactTitle: research.contactTitle,
        contactEmail,
        contactPhone: research.contactPhone,
        contactLinkedinUrl: research.contactLinkedinUrl,
        fallbackEmail,
      },
    };

    // Committing the lead is the one consequential write in this pipeline
    // (SPEC.md §19) — it gets its own audit record, distinct from the three
    // LLM agent runs above, because it's the point where a deterministic
    // decision (not a model) causes a real CRM change.
    const runId = randomUUID();
    const startedAt = new Date();
    const persistResult = await this.invokeTool("persist_discovered_company", persistInput);

    await this.deps.audit.record({
      runId,
      agentId: "discovery_pipeline",
      agentVersion: "0.1.0",
      model: "n/a",
      startedAt,
      finishedAt: new Date(),
      input: persistInput,
      output: persistResult.status === "succeeded" ? persistResult.output : null,
      toolCalls: [
        {
          tool: "persist_discovered_company",
          input: persistInput,
          output: persistResult.status === "succeeded" ? persistResult.output : null,
        },
      ],
      status: persistResult.status,
      error:
        persistResult.status === "denied"
          ? persistResult.reason
          : persistResult.status === "failed"
            ? persistResult.error
            : undefined,
    });

    if (persistResult.status !== "succeeded") {
      throw new Error(
        `persist_discovered_company ${persistResult.status}: ${
          persistResult.status === "denied" ? persistResult.reason : persistResult.error
        }`
      );
    }

    return {
      placeId: candidate.placeId,
      name: candidate.name,
      outcome: status,
      score,
      tier,
      companyId: (persistResult.output as { companyId: string }).companyId,
    };
  }

  private invokeTool(toolName: string, toolInput: unknown) {
    const runId = randomUUID();
    return this.toolExecutor.invoke({
      agentId: "discovery_pipeline",
      autonomyLevel: AUTONOMY.AUTONOMOUS_ROUTINE,
      toolName,
      toolInput,
      ctx: { agentId: "discovery_pipeline", runId },
    });
  }
}
