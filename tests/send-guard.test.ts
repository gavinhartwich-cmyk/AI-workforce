import { describe, expect, it } from "vitest";
import { checkSendAllowed } from "../src/outreach/send-guard.js";
import type { OptOutStore } from "../src/outreach/opt-out-store.js";
import type { OutreachControlStore, OutreachControlState } from "../src/outreach/outreach-control-store.js";
import type { EmailAccountsStore, EmailAccountState } from "../src/db/hartwich-os/email-accounts-store.js";

const WEEKDAY_BUSINESS_HOURS = new Date("2026-01-07T16:00:00Z"); // Wed 10am Winnipeg

class FakeOptOutStore implements OptOutStore {
  constructor(private suppressed: Set<string> = new Set()) {}
  async isSuppressed(email: string) {
    return this.suppressed.has(email.toLowerCase());
  }
  async suppress() {}
}

class FakeControlStore implements OutreachControlStore {
  constructor(private state: OutreachControlState = { sendingPaused: false, pausedReason: null }) {}
  async getState() {
    return this.state;
  }
  async pause() {}
  async resume() {}
}

class FakeAccountsStore implements EmailAccountsStore {
  constructor(private states: Record<number, EmailAccountState>) {}
  async getState(accountIndex: 0 | 1 | 2) {
    return this.states[accountIndex] ?? { accountIndex, warmupStartedAt: null, activeSendDays: 0, dailySendCount: 0, lastSentAt: null };
  }
  async recordSend() {}
}

const availableAccounts = new FakeAccountsStore({
  0: { accountIndex: 0, warmupStartedAt: null, activeSendDays: 0, dailySendCount: 0, lastSentAt: null },
  1: { accountIndex: 1, warmupStartedAt: null, activeSendDays: 0, dailySendCount: 0, lastSentAt: null },
  2: { accountIndex: 2, warmupStartedAt: null, activeSendDays: 0, dailySendCount: 0, lastSentAt: null },
});

describe("checkSendAllowed", () => {
  it("allows a send that clears every check", async () => {
    const result = await checkSendAllowed(
      { optOuts: new FakeOptOutStore(), control: new FakeControlStore(), accounts: availableAccounts },
      "prospect@example.com",
      WEEKDAY_BUSINESS_HOURS
    );
    expect(result.allowed).toBe(true);
  });

  it("permanently blocks a suppressed address, before any other check", async () => {
    const result = await checkSendAllowed(
      {
        optOuts: new FakeOptOutStore(new Set(["prospect@example.com"])),
        control: new FakeControlStore(),
        accounts: availableAccounts,
      },
      "prospect@example.com",
      WEEKDAY_BUSINESS_HOURS
    );
    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error("unreachable");
    expect(result.permanent).toBe(true);
  });

  it("defers (not permanently) while the kill switch is paused", async () => {
    const result = await checkSendAllowed(
      {
        optOuts: new FakeOptOutStore(),
        control: new FakeControlStore({ sendingPaused: true, pausedReason: "investigating a bounce spike" }),
        accounts: availableAccounts,
      },
      "prospect@example.com",
      WEEKDAY_BUSINESS_HOURS
    );
    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error("unreachable");
    expect(result.permanent).toBe(false);
    expect(result.reason).toMatch(/investigating a bounce spike/);
  });

  it("defers outside the sending window", async () => {
    const result = await checkSendAllowed(
      { optOuts: new FakeOptOutStore(), control: new FakeControlStore(), accounts: availableAccounts },
      "prospect@example.com",
      new Date("2026-01-10T16:00:00Z") // Saturday
    );
    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error("unreachable");
    expect(result.permanent).toBe(false);
  });

  it("defers when every account is over its warm-up limit", async () => {
    const maxedOut = new FakeAccountsStore({
      0: { accountIndex: 0, warmupStartedAt: null, activeSendDays: 0, dailySendCount: 3, lastSentAt: null },
      1: { accountIndex: 1, warmupStartedAt: null, activeSendDays: 0, dailySendCount: 3, lastSentAt: null },
      2: { accountIndex: 2, warmupStartedAt: null, activeSendDays: 0, dailySendCount: 3, lastSentAt: null },
    });
    const result = await checkSendAllowed(
      { optOuts: new FakeOptOutStore(), control: new FakeControlStore(), accounts: maxedOut },
      "prospect@example.com",
      WEEKDAY_BUSINESS_HOURS
    );
    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error("unreachable");
    expect(result.permanent).toBe(false);
  });
});
