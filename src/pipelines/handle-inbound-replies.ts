import { randomUUID } from "node:crypto";
import { AgentRuntime } from "../runtime/agent-runtime.js";
import { ToolExecutor } from "../runtime/tool-executor.js";
import { ToolRegistry } from "../runtime/tool-registry.js";
import type { PolicyEngine } from "../runtime/types.js";
import { AUTONOMY } from "../runtime/autonomy-levels.js";
import { conversationIntelligenceAgent, type ConversationClassification } from "../agents/conversation-intelligence-agent.js";
import { outreachReplyAgent } from "../agents/outreach-reply-agent.js";
import { appointmentAgent } from "../agents/appointment-agent.js";
import { decideReplyAction } from "../outreach/reply-routing.js";
import { checkSendAllowed } from "../outreach/send-guard.js";
import { buildBookingLink } from "../outreach/booking-link.js";
import { buildCompanyUrl } from "../outreach/app-url.js";
import type { OptOutStore } from "../outreach/opt-out-store.js";
import type { OutreachControlStore } from "../outreach/outreach-control-store.js";
import type { EmailAccountsStore } from "../db/hartwich-os/email-accounts-store.js";
import type { MatchedReply } from "../tools/get-unread-replies.js";

export type HandleReplyResult =
  | { threadId: string; outcome: "replied"; classification: ConversationClassification; activityId: string; messageId: string }
  | { threadId: string; outcome: "suppressed" | "closed_lost" | "escalated" | "no_action"; classification: ConversationClassification }
  | { threadId: string; outcome: "deferred"; classification: ConversationClassification; reason: string }
  | { threadId: string; outcome: "error"; error: string };

/**
 * Phase 6's core loop (SPEC.md §55): classify every genuine inbound reply,
 * then act on it per src/outreach/reply-routing.ts's deterministic
 * decision. Reuses Phase 5's exact send-guard for any autonomous reply —
 * a reply is still outbound email, still subject to the kill switch and
 * warm-up limits (opt-out doesn't apply to a reply to someone who just
 * wrote to us, but the guard checks it anyway; harmless no-op there).
 */
export class HandleInboundRepliesPipeline {
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

  async runAll(now: Date = new Date()): Promise<HandleReplyResult[]> {
    const repliesResult = await this.invokeTool("get_unread_replies", {});
    if (repliesResult.status !== "succeeded") {
      throw new Error(
        `get_unread_replies ${repliesResult.status}: ${
          repliesResult.status === "denied" ? repliesResult.reason : repliesResult.error
        }`
      );
    }
    const replies = repliesResult.output as MatchedReply[];

    const results: HandleReplyResult[] = [];
    for (const reply of replies) {
      let result: HandleReplyResult;
      try {
        result = await this.processReply(reply, now);
      } catch (err) {
        result = { threadId: reply.threadId, outcome: "error", error: err instanceof Error ? err.message : String(err) };
      }
      // Mark read regardless of outcome — an error handling it once
      // doesn't mean retrying the same message forever is the fix.
      await this.invokeTool("mark_email_read", { accountIndex: reply.accountIndex, gmailMessageId: reply.gmailMessageId });
      results.push(result);
    }
    return results;
  }

  private async processReply(reply: MatchedReply, now: Date): Promise<HandleReplyResult> {
    const recordResult = await this.invokeTool("record_inbound_reply", {
      companyId: reply.companyId,
      contactId: reply.contactId,
      dealId: reply.dealId,
      fromAddress: reply.fromAddress,
      subject: reply.originalSubject,
      body: reply.bodyText,
      providerMessageId: reply.gmailMessageId,
      threadId: reply.threadId,
    });
    if (recordResult.status !== "succeeded") {
      return {
        threadId: reply.threadId,
        outcome: "error",
        error: `record_inbound_reply ${recordResult.status}: ${
          recordResult.status === "denied" ? recordResult.reason : recordResult.error
        }`,
      };
    }

    const classifyRun = await this.deps.runtime.run(conversationIntelligenceAgent, {
      company: reply.company,
      originalSubject: reply.originalSubject,
      replyText: reply.bodyText,
    });
    if (classifyRun.status !== "succeeded") {
      return {
        threadId: reply.threadId,
        outcome: "error",
        error: `Conversation Intelligence Agent ${classifyRun.status}: ${
          classifyRun.status === "denied" ? classifyRun.reason : classifyRun.error
        }`,
      };
    }
    const classification = classifyRun.output;
    const route = decideReplyAction(classification.classification, classification.confidence, classification.appointmentIntent);

    switch (route.action) {
      case "suppress": {
        await this.deps.optOuts.suppress(reply.fromAddress, "asked to stop being contacted");
        return { threadId: reply.threadId, outcome: "suppressed", classification: classification.classification };
      }

      case "close_lost": {
        if (reply.dealId) await this.invokeBestEffort("close_deal_lost", { dealId: reply.dealId });
        await this.invokeBestEffort("append_company_note", {
          companyId: reply.companyId,
          note: `Closed lost — reply classified ${classification.classification}: ${classification.summary}`,
        });
        return { threadId: reply.threadId, outcome: "closed_lost", classification: classification.classification };
      }

      case "no_action":
        return { threadId: reply.threadId, outcome: "no_action", classification: classification.classification };

      case "escalate": {
        const companyLink = buildCompanyUrl(reply.companyId);
        await this.invokeTool("notify_gavin", {
          subject: `${reply.company.name} needs a look (${classification.classification})`,
          body: `${reply.company.name} replied: "${classification.summary}"\n\nClassification: ${classification.classification}\nConfidence: ${classification.confidence}\n\nOriginal message:\n${reply.bodyText}\n\n${companyLink}`,
        });
        if (reply.dealId) await this.invokeBestEffort("flag_deal_for_review", { dealId: reply.dealId });
        await this.invokeBestEffort("append_company_note", {
          companyId: reply.companyId,
          note: `Escalated to Gavin — reply classified ${classification.classification}: ${classification.summary}`,
        });
        await this.invokeBestEffort("create_escalation_task", {
          companyId: reply.companyId,
          dealId: reply.dealId,
          dueDate: new Date(now.getTime() + 4 * 60 * 60 * 1000), // 4 hours out — PRICE/HOSTILE are urgent, not next-week items
          description: `${reply.company.name} replied (${classification.classification}) and needs a human response — ${companyLink}`,
        });
        return { threadId: reply.threadId, outcome: "escalated", classification: classification.classification };
      }

      case "autonomous_reply": {
        // No contact/deal on file — shouldn't happen for a genuine reply
        // (we only ever send when both exist, per Phase 4/5's own
        // no_contact/no_deal guards), but fail safe by escalating rather
        // than guessing at who's writing back or crashing on a missing id.
        if (!reply.contactId || !reply.dealId) {
          await this.invokeTool("notify_gavin", {
            subject: `${reply.company.name} replied — incomplete CRM record`,
            body: `${reply.company.name} (${reply.fromAddress}) replied but is missing a contact or deal record:\n\n${reply.bodyText}`,
          });
          await this.invokeBestEffort("create_escalation_task", {
            companyId: reply.companyId,
            dealId: reply.dealId,
            dueDate: new Date(now.getTime() + 4 * 60 * 60 * 1000),
            description: `${reply.company.name} replied but is missing a contact or deal record — needs a manual look.`,
          });
          return { threadId: reply.threadId, outcome: "escalated", classification: classification.classification };
        }

        const guard = await checkSendAllowed(this.deps, reply.fromAddress, now);
        if (!guard.allowed) {
          return { threadId: reply.threadId, outcome: "deferred", classification: classification.classification, reason: guard.reason };
        }

        const yourName = this.deps.yourName ?? "Gavin Hartwich";
        const yourCompany = this.deps.yourCompany ?? "Hartwich Labs";

        const draft = route.useAppointmentAgent
          ? await this.deps.runtime.run(appointmentAgent, {
              company: reply.company,
              contact: reply.contact,
              originalSubject: reply.originalSubject,
              replyText: reply.bodyText,
              bookingLink: buildBookingLink({ companyId: reply.companyId, contactId: reply.contactId, dealId: reply.dealId }),
              yourName,
              yourCompany,
            })
          : await this.deps.runtime.run(outreachReplyAgent, {
              company: reply.company,
              contact: reply.contact,
              originalSubject: reply.originalSubject,
              replyText: reply.bodyText,
              yourName,
              yourCompany,
            });

        if (draft.status !== "succeeded") {
          return {
            threadId: reply.threadId,
            outcome: "error",
            error: `reply generation ${draft.status}: ${draft.status === "denied" ? draft.reason : draft.error}`,
          };
        }

        const sendResult = await this.invokeTool("send_email", {
          accountIndex: guard.accountIndex,
          to: reply.fromAddress,
          subject: draft.output.subject,
          body: draft.output.body,
          inReplyTo: reply.rfc822MessageId ?? undefined,
          references: reply.rfc822MessageId ?? undefined,
          threadId: reply.threadId,
        });
        if (sendResult.status !== "succeeded") {
          return {
            threadId: reply.threadId,
            outcome: "error",
            error: `send_email ${sendResult.status}: ${sendResult.status === "denied" ? sendResult.reason : sendResult.error}`,
          };
        }
        const sent = sendResult.output as { messageId: string; fromAddress: string; threadId: string | null };
        await this.deps.accounts.recordSend(guard.accountIndex, now);

        const recordSendResult = await this.invokeTool("record_outbound_email", {
          companyId: reply.companyId,
          contactId: reply.contactId,
          dealId: reply.dealId,
          kind: "reply",
          accountIndex: guard.accountIndex,
          to: reply.fromAddress,
          fromAddress: sent.fromAddress,
          subject: draft.output.subject,
          body: draft.output.body,
          providerMessageId: sent.messageId,
          threadId: sent.threadId ?? reply.threadId,
        });
        if (recordSendResult.status !== "succeeded") {
          return {
            threadId: reply.threadId,
            outcome: "error",
            error: `record_outbound_email ${recordSendResult.status}: ${
              recordSendResult.status === "denied" ? recordSendResult.reason : recordSendResult.error
            }`,
          };
        }

        const recorded = recordSendResult.output as { activityId: string; messageId: string };
        return {
          threadId: reply.threadId,
          outcome: "replied",
          classification: classification.classification,
          activityId: recorded.activityId,
          messageId: recorded.messageId,
        };
      }
    }
  }

  private invokeTool(toolName: string, toolInput: unknown) {
    const runId = randomUUID();
    return this.toolExecutor.invoke({
      agentId: "inbound_reply_pipeline",
      autonomyLevel: AUTONOMY.AUTONOMOUS_ROUTINE,
      toolName,
      toolInput,
      ctx: { agentId: "inbound_reply_pipeline", runId },
    });
  }

  /**
   * For secondary CRM bookkeeping (a note, an escalation task, closing a
   * deal) that shouldn't block or fail the primary outcome we already
   * committed to (closed_lost / escalated) — a missing tool registration
   * or a transient write failure here shouldn't look like the reply itself
   * was mishandled. Still surfaced, never swallowed silently: logged so
   * it's visible in the pipeline's own output/monitoring, per Gavin's
   * "properly handled... I can still see" bar from Phase 5.
   */
  private async invokeBestEffort(toolName: string, toolInput: unknown): Promise<void> {
    const result = await this.invokeTool(toolName, toolInput);
    if (result.status !== "succeeded") {
      console.error(`${toolName} ${result.status}: ${result.status === "denied" ? result.reason : result.error}`);
    }
  }
}
