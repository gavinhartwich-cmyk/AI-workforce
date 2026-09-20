import { describe, expect, it } from "vitest";
import { FollowUpApprovalReviewer } from "../src/manager/followup-approvals.js";
import type { FollowUpDraftReader, PendingAiFollowUp } from "../src/db/hartwich-os/followup-draft-reader.js";
import type { EmailAccountsStore, EmailAccountState } from "../src/db/hartwich-os/email-accounts-store.js";
import { NotImplementedWriteStore } from "../src/db/hartwich-os/write-store-stub.js";

const PENDING: PendingAiFollowUp[] = [
  { draftId: "11111111-1111-4111-8111-111111111111", companyName: "Example HVAC Co." },
  { draftId: "22222222-2222-4222-8222-222222222222", companyName: "Second Co." },
];

function fakeReader(pending: PendingAiFollowUp[]): FollowUpDraftReader {
  return { async listPendingAiFollowUps() { return pending; } };
}

function fakeAccounts(activeSendDaysByAccount: Record<0 | 1 | 2, number>): EmailAccountsStore {
  return {
    async getState(accountIndex: 0 | 1 | 2): Promise<EmailAccountState> {
      return {
        accountIndex,
        warmupStartedAt: null,
        activeSendDays: activeSendDaysByAccount[accountIndex],
        dailySendCount: 0,
        lastSentAt: null,
      };
    },
    async recordSend() {},
  };
}

class RecordingWriteStore extends NotImplementedWriteStore {
  approved: string[] = [];
  async approveFollowUpDraft(draftId: string): Promise<void> {
    this.approved.push(draftId);
  }
}

describe("FollowUpApprovalReviewer", () => {
  it("approves every pending AI follow-up once all 3 accounts are fully warm", async () => {
    const writeStore = new RecordingWriteStore();
    const reviewer = new FollowUpApprovalReviewer({
      drafts: fakeReader(PENDING),
      accounts: fakeAccounts({ 0: 29, 1: 40, 2: 30 }),
      writeStore,
    });

    const result = await reviewer.reviewPending();

    expect(result).toEqual({ approved: 2, waiting: 0 });
    expect(writeStore.approved).toEqual(PENDING.map((p) => p.draftId));
  });

  it("approves nothing while even one account is still warming up", async () => {
    const writeStore = new RecordingWriteStore();
    const reviewer = new FollowUpApprovalReviewer({
      drafts: fakeReader(PENDING),
      accounts: fakeAccounts({ 0: 29, 1: 29, 2: 10 }), // account 2 short of the 29-day bar
      writeStore,
    });

    const result = await reviewer.reviewPending();

    expect(result).toEqual({ approved: 0, waiting: 2 });
    expect(writeStore.approved).toEqual([]);
  });

  it("is a no-op with nothing pending, without even checking warm-up state", async () => {
    const writeStore = new RecordingWriteStore();
    let stateChecked = false;
    const accounts: EmailAccountsStore = {
      async getState(accountIndex: 0 | 1 | 2) {
        stateChecked = true;
        return { accountIndex, warmupStartedAt: null, activeSendDays: 0, dailySendCount: 0, lastSentAt: null };
      },
      async recordSend() {},
    };

    const result = await new FollowUpApprovalReviewer({ drafts: fakeReader([]), accounts, writeStore }).reviewPending();

    expect(result).toEqual({ approved: 0, waiting: 0 });
    expect(stateChecked).toBe(false);
  });
});
