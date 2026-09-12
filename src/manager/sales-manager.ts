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
import type { EscalationStore, ManagerEscalation } from "./escalation-store.js";
import type { DiscoverResearchQualifyInput, PipelineSummary } from "../pipelines/discover-research-qualify.js";
import { currentDiscoveryTargets, AREAS_PER_CYCLE, BASE_DISCOVERY_VOLUME, type DiscoveryTarget } from "../config/icp-targets.js";

/** A fixed, pre-approved copywriting variation — not LLM-invented copy, so it needs no per-run approval (SPEC.md §20's "approved... messaging rules"). */
const DEFAULT_EXPERIMENT_TEST_DIRECTIVE =
  "Lead with a single, concrete outcome a similar customer got, instead of a general pitch about services offered.";
/** Documented placeholder, not a calibrated power calculation — same honesty norm as pace-forecast.ts's own probability heuristic. */
const DEFAULT_EXPERIMENT_MIN_SAMPLE_PER_VARIANT = 30;

/**
 * How many times an approved escalation is retried before it's treated as
 * genuinely failed and put back in front of Gavin. Sized for the failure
 * that actually happens — a Groq daily-cap 429, which clears on its own —
 * so a full day of 15-minute cycles can't burn through it, but a decision
 * that is really broken still surfaces rather than retrying forever.
 */
const MAX_EXECUTION_ATTEMPTS = 8;

export type ManagerCycleExecution =
  | { kind: "none" }
  | { kind: "discovery_increase"; maxResults: number; runs: { target: DiscoveryTarget; summary: PipelineSummary }[] }
  | { kind: "experiment_created"; experimentId: string; name: string }
  | { kind: "escalated"; reason: string }
  /**
   * The same decision is already in front of Gavin, so nothing was raised
   * this cycle. Distinct from "escalated" because conflating them made the
   * decision log claim it escalated 32 times when it escalated once — the
   * dashboard's recent-decisions list showed eight identical "Escalate to
   * Gavin" rows and read as if it were still spamming (Gavin, 2026-09-11).
   */
  | { kind: "awaiting_decision"; escalationId: string; since: Date; status: string };

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
      /**
       * Holds decisions that exceed the manager's own authority until Gavin
       * approves them on /ai-workforce. Omitted (tests, demos) keeps the old
       * notify-and-file-a-task behaviour with no dedup.
       */
      escalations?: EscalationStore;
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
    await this.executeApprovedEscalations(now);
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
        const outcome = await this.escalate(report, primary, reason, now);

        if (outcome.raised) {
          selectedAction = `Escalate to Gavin — "${primary.action}" needs a human decision (${reason}).`;
          expectedOutcome = "n/a until Gavin decides — no autonomous action was taken this cycle.";
          execution = { kind: "escalated", reason };
        } else {
          // Say what actually happened. Wording a suppressed cycle as another
          // escalation is how the log came to show 32 of them when one was
          // ever raised.
          const open = outcome.blocking;
          selectedAction = `Waiting on Gavin — "${primary.action}" was escalated ${formatUtcMinute(open.createdAt)} and is still ${open.status}; not re-raised this cycle.`;
          expectedOutcome = "n/a — the existing escalation is still open; nothing new was raised or sent.";
          execution = { kind: "awaiting_decision", escalationId: open.id, since: open.createdAt, status: open.status };
        }
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

  /**
   * Scales discovery volume by searching MORE AREAS, not by asking for more
   * results per area.
   *
   * BASE_DISCOVERY_VOLUME is already 20, which is exactly the hard cap
   * search_google_places enforces on `maxResults` (Google's own page size).
   * So the old approach — multiplying maxResults by the increase — produced
   * 24 for a +20% and 40 for a +100%, and the tool rejected every one of
   * them with "Too big: expected number to be <=20". That meant this
   * capability had never actually worked: not the autonomous +20%, and not
   * an increase Gavin had explicitly approved (2026-09-10). Areas are the
   * axis that can actually grow.
   */
  private async executeDiscoveryIncrease(
    candidate: InterventionCandidate
  ): Promise<Extract<ManagerCycleExecution, { kind: "discovery_increase" }>> {
    const multiplier = 1 + (candidate.proposedChangePercent ?? 0) / 100;
    const areaCount = Math.max(1, Math.round(AREAS_PER_CYCLE * multiplier));
    const targets = this.deps.discoveryTargets ?? currentDiscoveryTargets(new Date(), areaCount);
    const runs: { target: DiscoveryTarget; summary: PipelineSummary }[] = [];
    for (const target of targets) {
      const summary = await this.deps.discovery.run({
        area: target.area,
        keyword: target.keyword,
        maxResults: BASE_DISCOVERY_VOLUME,
      });
      runs.push({ target, summary });
    }
    return { kind: "discovery_increase", maxResults: BASE_DISCOVERY_VOLUME, runs };
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

  /**
   * Carries out whatever Gavin has already approved on /ai-workforce, before
   * this cycle diagnoses anything new — an approval that sat unexecuted would
   * just get re-escalated below as if he'd never answered.
   */
  private async executeApprovedEscalations(now: Date): Promise<void> {
    if (!this.deps.escalations) return;

    for (const escalation of await this.deps.escalations.listApproved()) {
      if (escalation.capability !== "discover_prospects") {
        await this.deps.escalations.markFailed(
          escalation.id,
          `No executor wired for capability "${escalation.capability}" — approved but cannot be carried out automatically.`,
          now
        );
        continue;
      }

      try {
        // Gavin's approval IS the authority here, so this deliberately runs
        // at the proposed percentage the policy cap would otherwise refuse.
        const execution = await this.executeDiscoveryIncrease({
          action: escalation.action,
          capability: escalation.capability,
          proposedChangePercent: escalation.proposedChangePercent ?? 0,
          expectedImpact: escalation.expectedImpact ?? 0,
          confidence: 0,
          risk: escalation.risk ?? 0,
        });
        const found = execution.runs.reduce((sum, r) => sum + r.summary.found, 0);
        await this.deps.escalations.markExecuted(
          escalation.id,
          `Ran discovery at ${execution.maxResults} results per area across ${execution.runs.length} area(s); ${found} candidate(s) found.`,
          now
        );
      } catch (err) {
        // An approval is durable. If carrying it out fails for an
        // environmental reason — Groq's daily token cap did exactly this on
        // 2026-09-10 — that's not a new decision for Gavin to make, and
        // re-asking him to approve what he already approved is pure noise.
        // Keep it approved and try again next cycle; only give up, and only
        // then put it back in front of him, after repeated failures.
        const note = err instanceof Error ? err.message : String(err);
        const attempts = escalation.executionAttempts + 1;
        if (attempts < MAX_EXECUTION_ATTEMPTS) {
          await this.deps.escalations.recordFailedAttempt(escalation.id, `Attempt ${attempts} failed: ${note}`, attempts, now);
        } else {
          await this.deps.escalations.markFailed(escalation.id, `Gave up after ${attempts} attempts. Last error: ${note}`, now);
        }
      }
    }
  }

  /**
   * Raises an escalation, or reports the open one that stopped it. The
   * caller needs to know which actually happened so the decision it records
   * says so — see the `awaiting_decision` execution kind.
   */
  private async escalate(
    report: Awaited<ReturnType<typeof getGoalStatusReport>>,
    candidate: InterventionCandidate,
    whyApprovalRequired: string,
    now: Date
  ): Promise<{ raised: true } | { raised: false; blocking: ManagerEscalation }> {
    if (this.deps.escalations) {
      // One live ask at a time per goal+capability, plus a cooldown after it
      // settles. Without the cooldown, approving one stopped it being
      // "pending" and the next cycle immediately re-raised the same decision
      // and re-emailed — so answering made the noise worse (2026-09-10).
      const blocking = await this.deps.escalations.findBlocking(
        report.goal.id,
        candidate.capability ?? "unknown",
        now,
        report.forecast.status
      );
      if (blocking) return { raised: false, blocking };

      await this.deps.escalations.raise({
        goalId: report.goal.id,
        capability: candidate.capability ?? "unknown",
        proposedChangePercent: candidate.proposedChangePercent ?? null,
        action: candidate.action,
        diagnosis: report.bottleneck.diagnosis,
        whyApprovalRequired,
        forecastStatus: report.forecast.status,
        expectedImpact: candidate.expectedImpact,
        risk: candidate.risk,
      });
    }

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
      "",
      "Approve or reject this on the AI Workforce page in Hartwich OS.",
    ].join("\n");

    await this.invokeBestEffort("notify_gavin", { subject: `Goal "${report.goal.metric}" needs a decision`, body });
    await this.invokeBestEffort("create_escalation_task", {
      companyId: null,
      dealId: null,
      dueDate: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      description: `Goal "${report.goal.metric}" (${report.forecast.status}): ${candidate.action} — ${whyApprovalRequired}`,
    });

    return { raised: true };
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

/** "2026-09-10 20:38Z" — enough to place a decision without a full ISO string in a log line. */
function formatUtcMinute(at: Date): string {
  return `${at.toISOString().slice(0, 16).replace("T", " ")}Z`;
}
