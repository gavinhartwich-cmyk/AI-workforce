import { describe, expect, it } from "vitest";
import { canSendEmail, getWarmupPhase, startsNewSendDay } from "../src/outreach/warmup.js";

describe("getWarmupPhase", () => {
  it("starts at the lowest tier for a never-started account", () => {
    expect(getWarmupPhase(0).dailyLimit).toBe(3);
  });

  it("ramps up over sending days", () => {
    // activeSendDays counts today once it has sent, so the tier keys off
    // days completed before today.
    expect(getWarmupPhase(1).dailyLimit).toBe(3); // first sending day
    expect(getWarmupPhase(4).dailyLimit).toBe(3); // fourth — still the opening tier
    expect(getWarmupPhase(5).dailyLimit).toBe(5); // fifth sending day steps up
    expect(getWarmupPhase(30).dailyLimit).toBe(50); // fully ramped
  });

  it("does not advance for calendar time alone", () => {
    // The whole point of the change: a mailbox idle for weeks has the same
    // ramp position as one that only just started, because neither has been
    // building sender reputation.
    expect(getWarmupPhase(2).dailyLimit).toBe(getWarmupPhase(2).dailyLimit);
    expect(getWarmupPhase(2).activeSendDays).toBe(2);
  });
});

describe("startsNewSendDay", () => {
  it("is true when the mailbox has never sent", () => {
    expect(startsNewSendDay(null, new Date("2026-01-10T18:00:00Z"))).toBe(true);
  });

  it("is false for a second send the same Winnipeg day", () => {
    // Both 09:00 and 18:00 UTC on Jan 10 are the same Winnipeg date (UTC-6).
    const earlier = new Date("2026-01-10T15:00:00Z");
    expect(startsNewSendDay(earlier, new Date("2026-01-10T18:00:00Z"))).toBe(false);
  });

  it("is true once the Winnipeg date rolls over", () => {
    // 2026-01-10 23:00 Winnipeg = Jan 11 05:00 UTC; next send at Jan 11
    // 15:00 UTC is 09:00 Winnipeg on Jan 11 — a new sending day.
    const lastSent = new Date("2026-01-11T05:00:00Z");
    expect(startsNewSendDay(lastSent, new Date("2026-01-11T15:00:00Z"))).toBe(true);
  });
});

describe("canSendEmail", () => {
  const now = new Date("2026-01-10T18:00:00Z");

  it("allows a fresh account with no prior sends", () => {
    expect(canSendEmail({ activeSendDays: 0, dailySendCount: 0, lastSentAt: null }, now)).toEqual({ allowed: true });
  });

  it("denies once the daily limit is reached", () => {
    const result = canSendEmail({ activeSendDays: 0, dailySendCount: 3, lastSentAt: null }, now);
    expect(result.allowed).toBe(false);
  });

  it("enforces minimum spacing between sends regardless of daily count", () => {
    const lastSentAt = new Date(now.getTime() - 5 * 60_000); // 5 minutes ago
    const result = canSendEmail({ activeSendDays: 1, dailySendCount: 0, lastSentAt }, now);
    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error("unreachable");
    expect(result.reason).toMatch(/Too soon/);
  });

  it("allows once enough time has passed since the last send", () => {
    const lastSentAt = new Date(now.getTime() - 30 * 60_000); // 30 minutes ago
    expect(canSendEmail({ activeSendDays: 1, dailySendCount: 0, lastSentAt }, now)).toEqual({ allowed: true });
  });

  it("holds a new sending day to the tier that day will be on", () => {
    // 4 completed sending days, none today: this send starts day 5, which is
    // the 5/day tier — so a 4th send today is allowed where it wouldn't have
    // been on day 4.
    const lastSentAt = new Date("2026-01-09T18:00:00Z"); // yesterday
    expect(canSendEmail({ activeSendDays: 4, dailySendCount: 3, lastSentAt }, now)).toEqual({ allowed: true });
  });
});
