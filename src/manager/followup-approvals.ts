import type { FollowUpDraftReader } from "../db/hartwich-os/followup-draft-reader.js";
import type { EmailAccountsStore } from "../db/hartwich-os/email-accounts-store.js";
import type { HartwichWriteStore } from "../db/hartwich-os/write-store.js";
import { isWarmupComplete } from "../outreach/warmup.js";

export type FollowUpApprovalResult = { approved: number; waiting: number };

/**
 * The Sales Manager's review of AI-drafted follow-ups sitting in
 * hartwich-os's email_drafts queue (Gavin, 2026-09-20: "send the approval
 * to the AI Workforce Manager and he will allow it... this only applies
 * for the AI Workforce approvals, the manual stuff is still approved by
 * us"). FollowUpDraftReader already scopes to aiWorkforceCreated
 * companies only — a manually-sourced deal's follow-up never reaches this
 * code at all, regardless of warm-up state.
 *
 * Deterministic like the rest of this class — no model call, same "model
 * classifies, code decides" reasoning sales-manager.ts itself is built on.
 * The bar is exactly what Gavin asked for: every one of the 3 shared
 * sending accounts has to have finished warm-up (isWarmupComplete) before
 * routine follow-ups stop needing a human to read them first. Checked once
 * per call, not per draft — it's the same answer for every draft this
 * cycle and warm-up state can't change mid-loop.
 */
export class FollowUpApprovalReviewer {
  constructor(
    private deps: {
      drafts: FollowUpDraftReader;
      accounts: EmailAccountsStore;
      writeStore: HartwichWriteStore;
    }
  ) {}

  async reviewPending(): Promise<FollowUpApprovalResult> {
    const pending = await this.deps.drafts.listPendingAiFollowUps();
    if (pending.length === 0) return { approved: 0, waiting: 0 };

    const states = await Promise.all([0, 1, 2].map((i) => this.deps.accounts.getState(i as 0 | 1 | 2)));
    const fullyWarm = states.every((s) => isWarmupComplete(s.activeSendDays));
    if (!fullyWarm) return { approved: 0, waiting: pending.length };

    for (const draft of pending) {
      await this.deps.writeStore.approveFollowUpDraft(draft.draftId, "sales_manager");
    }
    return { approved: pending.length, waiting: 0 };
  }
}
