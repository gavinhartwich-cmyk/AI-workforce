import { randomUUID } from "node:crypto";
import { AgentRuntime } from "../runtime/agent-runtime.js";
import { ToolExecutor } from "../runtime/tool-executor.js";
import { ToolRegistry } from "../runtime/tool-registry.js";
import type { AuditSink, PolicyEngine } from "../runtime/types.js";
import { AUTONOMY } from "../runtime/autonomy-levels.js";
import { prospectDiscoveryAgent } from "../agents/prospect-discovery-agent.js";
import { prospectAssessmentAgent } from "../agents/prospect-assessment-agent.js";
import {
  computeQualificationScore,
  DEFAULT_QUALIFICATION_CONFIG,
  type QualificationConfig,
} from "../qualification/scoring.js";
import type { PlaceCandidate } from "../tools/search-google-places.js";
import type { TokenBudget } from "../runtime/token-budget.js";
import { MAX_GOOGLE_REVIEW_COUNT } from "../config/icp-targets.js";

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
  outcome:
    | "qualified"
    | "needs_review"
    | "disqualified"
    | "filtered_out"
    | "duplicate"
    | "error"
    /** Stopped short to leave Groq tokens for the Sales Manager chat — see src/runtime/token-budget.ts. */
    | "skipped_no_budget"
    /** Above the ICP's Google-review ceiling — already has the reputation this offer builds. */
    | "too_many_reviews";
  /** Present on `too_many_reviews`, so the log says how far over the line it was. */
  reviewCount?: number;
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
      /**
       * Stops the pipeline once the agents have spent their share of Groq's
       * daily token allowance, leaving the rest for the Sales Manager chat.
       * Omitted (tests, demos) means no gating at all.
       */
      budget?: TokenBudget;
      /** Overrides the ICP Google-review ceiling (tests). Defaults to MAX_GOOGLE_REVIEW_COUNT. */
      maxGoogleReviewCount?: number;
    }
  ) {
    this.toolExecutor = new ToolExecutor({ tools: deps.tools, policy: deps.policy });
  }

  /** True when the agents have spent their daily share and should stop. */
  private async outOfBudget(): Promise<boolean> {
    if (!this.deps.budget) return false;
    const state = await this.deps.budget.state();
    return state.exhausted;
  }

  async run(input: DiscoverResearchQualifyInput): Promise<PipelineSummary> {
    const exclusions = input.exclusions ?? [];

    // Checked before the Places call, not after: there's no point paying for
    // a search whose results can't be researched or qualified today.
    if (await this.outOfBudget()) {
      console.log("  ⏸ Skipping discovery — daily Groq token budget spent, leaving the rest for the Sales Manager chat.");
      return { found: 0, results: [] };
    }

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
    const allCandidates = searchResult.output as PlaceCandidate[];
    const results: PipelineCompanyResult[] = [];

    // Deterministic ICP ceiling, applied before any LLM call so an
    // out-of-ICP business costs zero Groq tokens. A company already holding
    // hundreds of reviews has solved the problem this offer sells — see
    // MAX_GOOGLE_REVIEW_COUNT. Candidates with no review count recorded are
    // kept: unknown isn't the same as too many.
    const reviewCeiling = this.deps.maxGoogleReviewCount ?? MAX_GOOGLE_REVIEW_COUNT;
    const candidates: PlaceCandidate[] = [];
    for (const candidate of allCandidates) {
      if (candidate.userRatingCount !== null && candidate.userRatingCount > reviewCeiling) {
        results.push({
          placeId: candidate.placeId,
          name: candidate.name,
          outcome: "too_many_reviews",
          reviewCount: candidate.userRatingCount,
        });
        continue;
      }
      candidates.push(candidate);
    }

    if (candidates.length === 0) return { found: allCandidates.length, results };

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

    let budgetSpent = false;
    for (const candidate of candidates) {
      const decision = keepMap.get(candidate.placeId);
      if (!decision || !decision.keep) {
        results.push({ placeId: candidate.placeId, name: candidate.name, outcome: "filtered_out" });
        continue;
      }

      // Re-checked per candidate rather than once up front: each one costs a
      // research + qualification call, so a long candidate list can cross the
      // line partway through and should stop there rather than run it out.
      if (budgetSpent || (await this.outOfBudget())) {
        budgetSpent = true;
        results.push({ placeId: candidate.placeId, name: candidate.name, outcome: "skipped_no_budget" });
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

    // `found` counts what the search returned, not what survived the ICP
    // ceiling — same meaning as the early return above.
    return { found: allCandidates.length, results };
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

    // One call, not two. The old research -> qualification chain re-sent the
    // Places data and the whole research object back in as the second call's
    // input, paying ~700-1000 tokens per candidate to restate what the model
    // had just produced (2026-09-11).
    const assessmentRun = await this.deps.runtime.run(prospectAssessmentAgent, {
      place: candidate,
      websiteText,
    });
    if (assessmentRun.status !== "succeeded") {
      throw new Error(
        `Prospect Assessment Agent ${assessmentRun.status}: ${
          assessmentRun.status === "denied" ? assessmentRun.reason : assessmentRun.error
        }`
      );
    }
    const { assessment: subscores, ...research } = assessmentRun.output;

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
