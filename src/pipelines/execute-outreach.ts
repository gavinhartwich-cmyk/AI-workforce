import { randomUUID } from "node:crypto";
import { AgentRuntime } from "../runtime/agent-runtime.js";
import { ToolExecutor } from "../runtime/tool-executor.js";
import { ToolRegistry } from "../runtime/tool-registry.js";
import type { PolicyEngine } from "../runtime/types.js";
import { AUTONOMY } from "../runtime/autonomy-levels.js";
import { outreachStrategyAgent } from "../agents/outreach-strategy-agent.js";
import { outreachGenerationAgent } from "../agents/outreach-generation-agent.js";
import { APPROVED_MESSAGING_CONFIG } from "../outreach/approved-messaging-config.js";
import { checkSendAllowed } from "../outreach/send-guard.js";
import type { OptOutStore } from "../outreach/opt-out-store.js";
import type { OutreachControlStore } from "../outreach/outreach-control-store.js";
import type { EmailAccountsStore } from "../db/hartwich-os/email-accounts-store.js";
import type { OutreachTarget } from "../tools/get-outreach-target.js";
import type { Experiment } from "../experiments/types.js";
import { assignVariant } from "../experiments/assignment.js";

export type ExecuteOutreachResult =
  | { companyId: string; outcome: "sent"; activityId: string; messageId: string; variantId?: string }
  | { companyId: string; outcome: "sent_but_not_recorded"; sentMessageId: string; error: string }
  | { companyId: string; outcome: "no_contact" | "no_deal" | "already_contacted" | "not_found" }
  | { companyId: string; outcome: "deferred" | "suppressed"; reason: string }
  | { companyId: string; outcome: "error"; error: string };

/**
 * Phase 5's core deliverable (SPEC.md §55 Phase 5, and Gavin's
 * 2026-09-XX direction): autonomous cold-outreach sending. No draft, no
 * per-email approval — routine outbound that clears every check in
 * src/outreach/send-guard.ts sends immediately. "Properly handled" +
 * "visible" + "can still intervene" are all real here, not just claimed:
 *
 *   - handled: opt-out, kill switch, sending window, and per-account
 *     warm-up rate limits are checked before every send, not just logged
 *     after (checkSendAllowed).
 *   - visible: a successful send is recorded as a real hartwich-os
 *     activity/message (write-store.ts's recordOutboundEmail) and moves
 *     the deal to "Contacted" — it shows up in hartwich-os's existing
 *     company/deal timeline, the same place a human-sent email would.
 *   - interventable: src/outreach/outreach-control-store.ts is a kill
 *     switch Gavin can flip without touching code; src/outreach/
 *     opt-out-store.ts stops any future send to a given address, no
 *     exceptions, permanently.
 */
export class ExecuteOutreachPipeline {
  private toolExecutor: ToolExecutor;

  constructor(
    private deps: {
      runtime: AgentRuntime;
      tools: ToolRegistry;
      policy: PolicyEngine;
      optOuts: OptOutStore;
      control: OutreachControlStore;
      accounts: EmailAccountsStore;
      yourName?: string;
      yourCompany?: string;
    }
  ) {
    this.toolExecutor = new ToolExecutor({ tools: deps.tools, policy: deps.policy });
  }

  async run(companyId: string, experiment?: Experiment, now: Date = new Date()): Promise<ExecuteOutreachResult> {
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
    if (!target) return { companyId, outcome: "not_found" };
    if (!target.contact?.email) return { companyId, outcome: "no_contact" };
    if (!target.dealId) return { companyId, outcome: "no_deal" };
    if (target.dealStageName !== "New Lead") return { companyId, outcome: "already_contacted" };

    const guard = await checkSendAllowed(this.deps, target.contact.email, now);
    if (!guard.allowed) {
      return { companyId, outcome: guard.permanent ? "suppressed" : "deferred", reason: guard.reason };
    }

    const variant = experiment ? assignVariant(experiment, companyId) : null;

    const strategyRun = await this.deps.runtime.run(outreachStrategyAgent, {
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
      contactKnown: !!target.contact.name,
      qualificationReasoning: target.company.qualificationReasoning,
      enabledChannels: APPROVED_MESSAGING_CONFIG.enabledChannels,
      experimentDirective: variant?.directive ?? null,
    });
    if (strategyRun.status !== "succeeded") {
      return {
        companyId,
        outcome: "error",
        error: `Outreach Strategy Agent ${strategyRun.status}: ${
          strategyRun.status === "denied" ? strategyRun.reason : strategyRun.error
        }`,
      };
    }

    const generationRun = await this.deps.runtime.run(outreachGenerationAgent, {
      company: { name: target.company.name, website: target.company.website },
      contact: { name: target.contact.name, title: target.contact.title },
      strategy: {
        angle: strategyRun.output.angle,
        hook: strategyRun.output.hook,
        personalizationPoints: strategyRun.output.personalizationPoints,
        cta: strategyRun.output.cta,
      },
      yourName: this.deps.yourName ?? "Gavin Hartwich",
      yourCompany: this.deps.yourCompany ?? "Hartwich Labs",
    });
    if (generationRun.status !== "succeeded") {
      return {
        companyId,
        outcome: "error",
        error: `Outreach Generation Agent ${generationRun.status}: ${
          generationRun.status === "denied" ? generationRun.reason : generationRun.error
        }`,
      };
    }

    const sendResult = await this.invokeTool("send_email", {
      accountIndex: guard.accountIndex,
      to: target.contact.email,
      subject: generationRun.output.initial.subject,
      body: generationRun.output.initial.body,
    });
    if (sendResult.status !== "succeeded") {
      return {
        companyId,
        outcome: "error",
        error: `send_email ${sendResult.status}: ${sendResult.status === "denied" ? sendResult.reason : sendResult.error}`,
      };
    }
    const sent = sendResult.output as { messageId: string; fromAddress: string; threadId: string | null };

    // The send already happened — from here, failures are recorded as
    // "sent but not recorded," never silently dropped or retried (retrying
    // would risk a second send to the same prospect).
    await this.deps.accounts.recordSend(guard.accountIndex, now);

    const recordResult = await this.invokeTool("record_outbound_email", {
      companyId: target.company.id,
      contactId: target.contact.id,
      dealId: target.dealId,
      kind: "cold_outreach",
      accountIndex: guard.accountIndex,
      to: target.contact.email,
      fromAddress: sent.fromAddress,
      subject: generationRun.output.initial.subject,
      body: generationRun.output.initial.body,
      providerMessageId: sent.messageId,
      threadId: sent.threadId,
    });
    if (recordResult.status !== "succeeded") {
      return {
        companyId,
        outcome: "sent_but_not_recorded",
        sentMessageId: sent.messageId,
        error: recordResult.status === "denied" ? recordResult.reason : recordResult.error,
      };
    }

    const recorded = recordResult.output as { activityId: string; messageId: string };
    return { companyId, outcome: "sent", activityId: recorded.activityId, messageId: recorded.messageId, variantId: variant?.id };
  }

  private invokeTool(toolName: string, toolInput: unknown) {
    const runId = randomUUID();
    return this.toolExecutor.invoke({
      agentId: "outreach_execution_pipeline",
      autonomyLevel: AUTONOMY.AUTONOMOUS_ROUTINE,
      toolName,
      toolInput,
      ctx: { agentId: "outreach_execution_pipeline", runId },
    });
  }
}
