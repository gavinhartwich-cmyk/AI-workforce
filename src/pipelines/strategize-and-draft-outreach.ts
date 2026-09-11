import { randomUUID } from "node:crypto";
import { AgentRuntime } from "../runtime/agent-runtime.js";
import { ToolExecutor } from "../runtime/tool-executor.js";
import { ToolRegistry } from "../runtime/tool-registry.js";
import type { PolicyEngine } from "../runtime/types.js";
import { AUTONOMY } from "../runtime/autonomy-levels.js";
import { outreachComposerAgent } from "../agents/outreach-composer-agent.js";
import { APPROVED_MESSAGING_CONFIG } from "../outreach/approved-messaging-config.js";
import type { Experiment } from "../experiments/types.js";
import { assignVariant } from "../experiments/assignment.js";
import type { OutreachTarget } from "../tools/get-outreach-target.js";

export type StrategizeAndDraftResult =
  | { companyId: string; outcome: "drafted"; draftId: string; variantId?: string }
  | { companyId: string; outcome: "no_contact" }
  | { companyId: string; outcome: "error"; error: string };

/**
 * Phase 4's end-to-end pipeline (SPEC.md §55 Phase 4): Strategy →
 * Generation → one pending-review draft in hartwich-os's existing
 * email_drafts queue. No sending — that's Phase 5. Every tool call
 * (read the target, write the draft) goes through the same policy-gated
 * ToolExecutor as every other pipeline in this repo.
 */
export class StrategizeAndDraftOutreachPipeline {
  private toolExecutor: ToolExecutor;

  constructor(
    private deps: {
      runtime: AgentRuntime;
      tools: ToolRegistry;
      policy: PolicyEngine;
      yourName?: string;
      yourCompany?: string;
    }
  ) {
    this.toolExecutor = new ToolExecutor({ tools: deps.tools, policy: deps.policy });
  }

  async run(companyId: string, experiment?: Experiment): Promise<StrategizeAndDraftResult> {
    const targetResult = await this.invokeTool("get_outreach_target", { companyId });
    if (targetResult.status !== "succeeded") {
      return {
        companyId,
        outcome: "error",
        error: `get_outreach_target ${targetResult.status}: ${
          targetResult.status === "denied" ? targetResult.reason : targetResult.error
        }`,
      };
    }

    const target = targetResult.output as OutreachTarget | null;

    if (!target || !target.contact?.email) {
      return { companyId, outcome: "no_contact" };
    }

    const variant = experiment ? assignVariant(experiment, companyId) : null;

    // Same single call the autonomous path uses (execute-outreach.ts) —
    // strategy and copy together rather than a chain that re-sent the
    // strategy back in as the second call's input.
    const generationRun = await this.deps.runtime.run(outreachComposerAgent, {
      company: {
        name: target.company.name,
        website: target.company.website,
        city: target.company.city,
        state: target.company.state,
        googleReviewCount: target.company.googleReviewCount,
        googleRating: target.company.googleRating != null ? Number(target.company.googleRating) : null,
        websiteSummary: target.company.websiteSummary,
        servicesOffered: target.company.servicesOffered,
        apparentSize: target.company.apparentSize,
      },
      contact: { name: target.contact.name, title: target.contact.title },
      qualificationReasoning: target.company.qualificationReasoning,
      enabledChannels: APPROVED_MESSAGING_CONFIG.enabledChannels,
      experimentDirective: variant?.directive ?? null,
      yourName: this.deps.yourName ?? "Gavin Hartwich",
      yourCompany: this.deps.yourCompany ?? "Hartwich Labs",
    });
    if (generationRun.status !== "succeeded") {
      return {
        companyId,
        outcome: "error",
        error: `Outreach Composer Agent ${generationRun.status}: ${
          generationRun.status === "denied" ? generationRun.reason : generationRun.error
        }`,
      };
    }

    // Only the initial message is persisted now — a follow-up needs a real
    // sent message to reference (thread, open status), which doesn't exist
    // until Phase 5 sends something. The generated follow-up copy is still
    // in this run's audit record (src/db/postgres-audit-sink.ts) for Phase
    // 5 to draw on when it's actually due, rather than being discarded.
    const draftResult = await this.invokeTool("create_email_draft", {
      companyId: target.company.id,
      contactId: target.contact.id,
      dealId: target.dealId,
      subject: generationRun.output.initial.subject,
      body: generationRun.output.initial.body,
      kind: "cold_outreach",
    });
    if (draftResult.status !== "succeeded") {
      return {
        companyId,
        outcome: "error",
        error: `create_email_draft ${draftResult.status}: ${
          draftResult.status === "denied" ? draftResult.reason : draftResult.error
        }`,
      };
    }

    return {
      companyId,
      outcome: "drafted",
      draftId: (draftResult.output as { draftId: string }).draftId,
      variantId: variant?.id,
    };
  }

  private invokeTool(toolName: string, toolInput: unknown) {
    const runId = randomUUID();
    return this.toolExecutor.invoke({
      agentId: "outreach_pipeline",
      autonomyLevel: AUTONOMY.AUTONOMOUS_ROUTINE,
      toolName,
      toolInput,
      ctx: { agentId: "outreach_pipeline", runId },
    });
  }
}
