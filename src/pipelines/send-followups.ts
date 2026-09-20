import { randomUUID } from "node:crypto";
import { AgentRuntime } from "../runtime/agent-runtime.js";
import { ToolExecutor } from "../runtime/tool-executor.js";
import { ToolRegistry } from "../runtime/tool-registry.js";
import type { PolicyEngine } from "../runtime/types.js";
import { AUTONOMY } from "../runtime/autonomy-levels.js";
import { outreachFollowUpAgent } from "../agents/outreach-followup-agent.js";
import { APPROVED_MESSAGING_CONFIG } from "../outreach/approved-messaging-config.js";
import { checkSendAllowed } from "../outreach/send-guard.js";
import { isFollowUpDue } from "../outreach/followup-cadence.js";
import type { OptOutStore } from "../outreach/opt-out-store.js";
import type { OutreachControlStore } from "../outreach/outreach-control-store.js";
import type { EmailAccountsStore } from "../db/hartwich-os/email-accounts-store.js";
import type { FollowUpCandidateTarget } from "../tools/get-followup-candidates.js";

export type FollowUpResult =
  | { dealId: string; outcome: "sent"; activityId: string; messageId: string }
  | { dealId: string; outcome: "sent_but_not_recorded"; sentMessageId: string; error: string }
  | { dealId: string; outcome: "not_due" | "no_contact" | "no_last_message" }
  | { dealId: string; outcome: "deferred" | "suppressed"; reason: string }
  | { dealId: string; outcome: "error"; error: string };

/**
 * Phase 5's second deliverable (SPEC.md §30/§55): autonomous follow-ups
 * for deals sitting in "Contacted" with no reply. Same send-guard
 * (opt-out/kill-switch/window/rate-limit) and the same visible-in-
 * hartwich-os recording as cold outreach — this pipeline only differs in
 * *which* deals it looks at and how the copy gets generated (a fresh,
 * purpose-built follow-up, not the one Phase 4 pre-drafted — see
 * src/agents/outreach-followup-agent.ts's header comment).
 *
 * Stops per SPEC.md §30: opt-out (via the shared send guard), a reply
 * already in (isFollowUpDue), or maxFollowUps reached (also
 * isFollowUpDue). "Explicit rejection" and "human takeover" as stop
 * conditions need Conversation Intelligence (Phase 6) to detect at all —
 * not something this phase can honestly claim yet.
 */
export class SendFollowUpsPipeline {
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

  async runAll(now: Date = new Date()): Promise<FollowUpResult[]> {
    const candidatesResult = await this.invokeTool("get_followup_candidates", {});
    if (candidatesResult.status !== "succeeded") {
      throw new Error(
        `get_followup_candidates ${candidatesResult.status}: ${
          candidatesResult.status === "denied" ? candidatesResult.reason : candidatesResult.error
        }`
      );
    }
    const candidates = candidatesResult.output as FollowUpCandidateTarget[];

    const results: FollowUpResult[] = [];
    for (const candidate of candidates) {
      results.push(await this.processCandidate(candidate, now));
    }
    return results;
  }

  private async processCandidate(candidate: FollowUpCandidateTarget, now: Date): Promise<FollowUpResult> {
    if (!isFollowUpDue(candidate, now, APPROVED_MESSAGING_CONFIG.maxFollowUps)) {
      return { dealId: candidate.dealId, outcome: "not_due" };
    }
    if (!candidate.contact?.email) return { dealId: candidate.dealId, outcome: "no_contact" };
    if (!candidate.lastMessage) return { dealId: candidate.dealId, outcome: "no_last_message" };

    const guard = await checkSendAllowed(this.deps, candidate.contact.email, now);
    if (!guard.allowed) {
      return { dealId: candidate.dealId, outcome: guard.permanent ? "suppressed" : "deferred", reason: guard.reason };
    }

    const generationRun = await this.deps.runtime.run(outreachFollowUpAgent, {
      company: candidate.company,
      contact: { name: candidate.contact.name, title: candidate.contact.title },
      originalSubject: candidate.lastMessage.subject,
      originalBody: candidate.lastMessage.body,
      followUpNumber: candidate.followUpCount + 1,
      yourName: this.deps.yourName ?? "Gavin Hartwich",
      yourCompany: this.deps.yourCompany ?? "Hartwich Labs",
    });
    if (generationRun.status !== "succeeded") {
      return {
        dealId: candidate.dealId,
        outcome: "error",
        error: `Outreach Follow-Up Agent ${generationRun.status}: ${
          generationRun.status === "denied" ? generationRun.reason : generationRun.error
        }`,
      };
    }

    const sendResult = await this.invokeTool("send_email", {
      accountIndex: guard.accountIndex,
      to: candidate.contact.email,
      subject: generationRun.output.subject,
      body: generationRun.output.body,
    });
    if (sendResult.status !== "succeeded") {
      return {
        dealId: candidate.dealId,
        outcome: "error",
        error: `send_email ${sendResult.status}: ${sendResult.status === "denied" ? sendResult.reason : sendResult.error}`,
      };
    }
    const sent = sendResult.output as { messageId: string; fromAddress: string; threadId: string | null };

    await this.deps.accounts.recordSend(guard.accountIndex, now);

    const recordResult = await this.invokeTool("record_outbound_email", {
      companyId: candidate.companyId,
      contactId: candidate.contact.id,
      dealId: candidate.dealId,
      kind: "follow_up",
      accountIndex: guard.accountIndex,
      to: candidate.contact.email,
      fromAddress: sent.fromAddress,
      subject: generationRun.output.subject,
      body: generationRun.output.body,
      providerMessageId: sent.messageId,
      threadId: sent.threadId,
    });
    if (recordResult.status !== "succeeded") {
      return {
        dealId: candidate.dealId,
        outcome: "sent_but_not_recorded",
        sentMessageId: sent.messageId,
        error: recordResult.status === "denied" ? recordResult.reason : recordResult.error,
      };
    }

    const recorded = recordResult.output as { activityId: string; messageId: string };
    return { dealId: candidate.dealId, outcome: "sent", activityId: recorded.activityId, messageId: recorded.messageId };
  }

  private invokeTool(toolName: string, toolInput: unknown) {
    const runId = randomUUID();
    return this.toolExecutor.invoke({
      agentId: "followup_pipeline",
      autonomyLevel: AUTONOMY.AUTONOMOUS_ROUTINE,
      toolName,
      toolInput,
      ctx: { agentId: "followup_pipeline", runId },
    });
  }
}
