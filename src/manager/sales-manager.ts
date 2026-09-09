import { randomUUID } from "node:crypto";
import { ToolExecutor } from "../runtime/tool-executor.js";
import type { ToolRegistry } from "../runtime/tool-registry.js";
import type { PolicyEngine } from "../runtime/types.js";
import { AUTONOMY } from "../runtime/autonomy-levels.js";
import type { GoalStore } from "../goals/goal-store.js";
import type { KpiSnapshotStore } from "../goals/kpi-snapshot-store.js";
import type { ForecastStore } from "../goals/forecast-store.js";
import type { ManagerDecisionStore } from "../goals/manager-decision-store.js";
import type { FunnelReader } from "../db/hartwich-os/funnel-reader.js";
import type { AgentHealthReader } from "../db/agent-health-reader.js";
import type { AnalyticsReader } from "../db/analytics-reader.js";
import { getGoalStatusReport } from "../goals/goal-status-report.js";
import type { ForecastThresholds } from "../goals/pace-forecast.js";
import type { GoalMetric, GoalStatus, ManagerDecisionOption } from "../goals/types.js";
import { deriveWorkIntensity } from "./work-intensity.js";
import { generateInterventionOptions } from "./intervention-generator.js";
import { checkAuthority, DEFAULT_AUTHORITY_POLICIES } from "./authority-policy.js";
import type { AuthorityPolicy, InterventionCandidate, WorkIntensity } from "./types.js";
import type { ExperimentStore } from "../experiments/experiment-store.js";
import type { DiscoverResearchQualifyInput, PipelineSummary } from "../pipelines/discover-research-qualify.js";
import { DEFAULT_DISCOVERY_TARGETS, BASE_DISCOVERY_VOLUME, type DiscoveryTarget } from "../config/icp-targets.js";

/** A fixed, pre-approved copywriting variation — not LLM-invented copy, so it needs no per-run approval (SPEC.md §20's "approved... messaging rules"). */
const DEFAULT_EXPERIMENT_TEST_DIRECTIVE =
  "Lead with a single, concrete outcome a similar customer got, instead of a general pitch about services offered.";
/** Documented placeholder, not a calibrated power calculation — same honesty norm as pace-forecast.ts's own probability heuristic. */
const DEFAULT_EXPERIMENT_MIN_SAMPLE_PER_VARIANT = 30;

export type ManagerCycleExecution =
  | { kind: "none" }
  | { kind: "discovery_increase"; maxResults: number; runs: { target: DiscoveryTarget; summary: PipelineSummary }[] }
  | { kind: "experiment_created"; experimentId: string; name: string }
  | { kind: "escalated"; reason: string };

export type ManagerCycleResult = {
  goalId: string;
  metric: GoalMetric;
  status: GoalStatus;
  intensity: WorkIntensity;
  decisionId: string;
  selectedAction: string;
  execution: ManagerCycleExecution;
};

function experimentNameForStage(fromStage: string, toStage: string): string {
  return `Outreach experiment: ${fromStage}->${toStage}`;
}

function formatRiskLabel(risk: number): "Low" | "Medium" | "High" {
  if (risk < 0.2) return "Low";
  if (risk < 0.4) return "Medium";
  return "High";
}

/**
 * SPEC.md §55 Phase 9 — "activate full Sales Manager control loop: GOAL →
 * PLAN → DELEGATE → EXECUTE → MEASURE → OPTIMIZE." Every earlier phase
 * built one piece of this; this class is the first thing that actually
 * runs the loop, cycle by cycle, per goal:
 *
 *   PLAN     — getGoalStatusReport (Phase 3) for the diagnosis, then
 *              generateInterventionOptions (SPEC.md §14 steps 2-5) for
 *              what could be done about it.
 *   DELEGATE/EXECUTE — checkAuthority (SPEC.md §18) decides whether the
 *              manager may act on its own; if so it actually does
 *              (triggers more Prospect Discovery, or starts a controlled
 *              experiment) — real side effects, not a proposal that waits
 *              for a human to click a button. If not, it escalates
 *              (SPEC.md §37's exact format) instead of quietly doing
 *              nothing or overstepping.
 *   MEASURE  — the KPI snapshot/forecast recording getGoalStatusReport
 *              already does, plus this cycle's own ManagerDecision record
 *              (SPEC.md §36) — real institutional memory, not the
 *              diagnosis-only placeholder Phase 3-8 left here.
 *   OPTIMIZE — runAll() re-runs this for every active goal; calling it on
 *              a recurring schedule (deployment-level, same as every other
 *              pipeline in this repo — none of them own their own cron
 *              either) is what makes the loop continuous.
 *
 * Deliberately LLM-free, like every engine it's built from (KPI Engine,
 * Bottleneck Engine, Pace/Forecast) — "model classifies, code decides" has
 * nothing left for a model to classify here: the diagnosis is already real
 * numbers, and choosing the best of at most one in-authority option is
 * arithmetic, not judgment.
 */
export class SalesManager {
  private toolExecutor: ToolExecutor;

  constructor(
    private deps: {
      goals: GoalStore;
      funnel: FunnelReader;
      agentHealth: AgentHealthReader;
      analytics: AnalyticsReader;
      kpiSnapshots: KpiSnapshotStore;
      forecasts: ForecastStore;
      decisions: ManagerDecisionStore;
      experiments: ExperimentStore;
      discovery: { run(input: DiscoverResearchQualifyInput): Promise<PipelineSummary> };
      tools: ToolRegistry;
      policy: PolicyEngine;
      discoveryTargets?: DiscoveryTarget[];
      authorityPolicies?: AuthorityPolicy[];
      targetConversionRates?: Record<string, number>;
      forecastThresholds?: ForecastThresholds;
    }
  ) {
    this.toolExecutor = new ToolExecutor({ tools: deps.tools, policy: deps.policy });
  }

  async runAll(now: Date = new Date()): Promise<ManagerCycleResult[]> {
    const goals = await this.deps.goals.listActive();
    const results: ManagerCycleResult[] = [];
    for (const goal of goals) results.push(await this.runCycle(goal.id, now));
    return results;
  }

  async runCycle(goalId: string, now: Date = new Date()): Promise<ManagerCycleResult> {
    const report = await getGoalStatusReport(
      goalId,
      {
        goals: this.deps.goals,
        funnel: this.deps.funnel,
        agentHealth: this.deps.agentHealth,
        analytics: this.deps.analytics,
        kpiSnapshots: this.deps.kpiSnapshots,
        forecasts: this.deps.forecasts,
        targetConversionRates: this.deps.targetConversionRates,
        forecastThresholds: this.deps.forecastThresholds,
      },
      now
    );

    const intensity = deriveWorkIntensity(report.forecast.status);
    const candidates = generateInterventionOptions(report.bottleneck, intensity);
    const primary = candidates[0] ?? null;

    let selectedAction: string;
    let expectedOutcome: string;
    let execution: ManagerCycleExecution;
    let recordedOptions: ManagerDecisionOption[];

    if (!primary) {
      selectedAction =
        intensity === "NORMAL"
          ? `Goal "${report.goal.metric}" is ${report.forecast.status} — no intervention needed this cycle.`
          : "No code-diagnosable bottleneck to act on this cycle — every measurable conversion is at or above target.";
      expectedOutcome = "n/a — no action was taken.";
      execution = { kind: "none" };
      recordedOptions = [];
    } else {
      // generateInterventionOptions only ever returns a candidate when
      // primaryBottleneck is non-null — `primary` existing guarantees this.
      const { fromStage, toStage } = report.bottleneck.primaryBottleneck!;

      const authority = checkAuthority(
        primary.capability,
        primary.proposedChangePercent,
        AUTONOMY.MANAGER_COORDINATION,
        this.deps.authorityPolicies ?? DEFAULT_AUTHORITY_POLICIES
      );

      const attempted =
        authority.allowed && primary.capability === "discover_prospects"
          ? await this.executeDiscoveryIncrease(primary)
          : authority.allowed && primary.capability === "create_controlled_experiment"
            ? await this.executeExperiment(primary, fromStage, toStage)
            : null;

      if (attempted) {
        selectedAction = primary.action;
        expectedOutcome = `Expect roughly +${primary.expectedImpact} at the final funnel stage if this closes the gap (confidence ${primary.confidence}).`;
        execution = attempted;
        recordedOptions = [primary];
      } else {
        // Either authority denied it outright, or (for an experiment) one
        // is already running for this exact stage and deserves time to
        // gather samples (SPEC.md §34) rather than a second, competing one.
        const reason = authority.allowed
          ? `An experiment is already running for the ${fromStage} → ${toStage} step — waiting for it to reach a conclusive sample size instead of starting another.`
          : authority.reason;
        selectedAction = `Escalate to Gavin — "${primary.action}" needs a human decision (${reason}).`;
        expectedOutcome = "n/a until Gavin decides — no autonomous action was taken this cycle.";
        await this.escalate(report, primary, reason, now);
        execution = { kind: "escalated", reason };
        recordedOptions = [
          primary,
          { action: "Escalate to Gavin", expectedImpact: primary.expectedImpact, confidence: 0.5, risk: 0.05 },
        ];
      }
    }

    const decisionId = await this.deps.decisions.record({
      goalId: report.goal.id,
      observation: report.bottleneck.observation,
      diagnosis: report.bottleneck.diagnosis,
      options: recordedOptions,
      selectedAction,
      reason: `Goal "${report.goal.metric}" is ${report.forecast.status} (${intensity}) — current ${report.kpi.value ?? 0}, projected final ${report.forecast.projectedFinal} vs. target ${report.goal.target}.`,
      expectedOutcome,
    });

    return {
      goalId: report.goal.id,
      metric: report.goal.metric,
      status: report.forecast.status,
      intensity,
      decisionId,
      selectedAction,
      execution,
    };
  }

  private async executeDiscoveryIncrease(
    candidate: InterventionCandidate
  ): Promise<Extract<ManagerCycleExecution, { kind: "discovery_increase" }>> {
    const maxResults = Math.round(BASE_DISCOVERY_VOLUME * (1 + (candidate.proposedChangePercent ?? 0) / 100));
    const targets = this.deps.discoveryTargets ?? DEFAULT_DISCOVERY_TARGETS;
    const runs: { target: DiscoveryTarget; summary: PipelineSummary }[] = [];
    for (const target of targets) {
      const summary = await this.deps.discovery.run({ area: target.area, keyword: target.keyword, maxResults });
      runs.push({ target, summary });
    }
    return { kind: "discovery_increase", maxResults, runs };
  }

  private async executeExperiment(
    candidate: InterventionCandidate,
    fromStage: string,
    toStage: string
  ): Promise<Extract<ManagerCycleExecution, { kind: "experiment_created" }> | null> {
    const name = experimentNameForStage(fromStage, toStage);
    const running = await this.deps.experiments.listRunning();
    if (running.some((e) => e.name === name)) return null; // already trying this — let it run, don't stack a duplicate

    const experiment = await this.deps.experiments.create({
      name,
      description: candidate.action,
      minSampleSizePerVariant: DEFAULT_EXPERIMENT_MIN_SAMPLE_PER_VARIANT,
      variants: [
        { name: "control", directive: "", weight: 1 },
        { name: "test", directive: DEFAULT_EXPERIMENT_TEST_DIRECTIVE, weight: 1 },
      ],
    });
    return { kind: "experiment_created", experimentId: experiment.id, name };
  }

  private async escalate(
    report: Awaited<ReturnType<typeof getGoalStatusReport>>,
    candidate: InterventionCandidate,
    whyApprovalRequired: string,
    now: Date
  ): Promise<void> {
    // SPEC.md §37's exact escalation format — context and a recommendation, not raw agent confusion.
    const body = [
      "GAVIN — DECISION REQUIRED",
      `GOAL: ${report.goal.target} ${report.goal.metric}`,
      `CURRENT FORECAST: ${report.forecast.projectedFinal}`,
      `ISSUE: ${report.bottleneck.diagnosis}`,
      `RECOMMENDATION: ${candidate.action}`,
      `EXPECTED IMPACT: +${candidate.expectedImpact} ${report.goal.metric}`,
      `RISK: ${formatRiskLabel(candidate.risk)}`,
      `WHY APPROVAL IS REQUIRED: ${whyApprovalRequired}`,
    ].join("\n");

    await this.invokeBestEffort("notify_gavin", { subject: `Goal "${report.goal.metric}" needs a decision`, body });
    await this.invokeBestEffort("create_escalation_task", {
      companyId: null,
      dealId: null,
      dueDate: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      description: `Goal "${report.goal.metric}" (${report.forecast.status}): ${candidate.action} — ${whyApprovalRequired}`,
    });
  }

  private invokeTool(toolName: string, toolInput: unknown) {
    const runId = randomUUID();
    return this.toolExecutor.invoke({
      agentId: "sales_manager",
      autonomyLevel: AUTONOMY.MANAGER_COORDINATION,
      toolName,
      toolInput,
      ctx: { agentId: "sales_manager", runId },
    });
  }

  /** Same "log, don't swallow, don't block the primary outcome" pattern as src/pipelines/handle-inbound-replies.ts's invokeBestEffort. */
  private async invokeBestEffort(toolName: string, toolInput: unknown): Promise<void> {
    const result = await this.invokeTool(toolName, toolInput);
    if (result.status !== "succeeded") {
      console.error(`${toolName} ${result.status}: ${result.status === "denied" ? result.reason : result.error}`);
    }
  }
}
