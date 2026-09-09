import { describe, expect, it } from "vitest";
import { canSendEmail, getWarmupPhase } from "../src/outreach/warmup.js";

describe("getWarmupPhase", () => {
  it("starts at the lowest tier for a never-started account", () => {
    expect(getWarmupPhase(null).dailyLimit).toBe(3);
  });

  it("ramps up over time", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    expect(getWarmupPhase(start, new Date("2026-01-01T01:00:00Z")).dailyLimit).toBe(3); // day 0
    expect(getWarmupPhase(start, new Date("2026-01-05T00:00:00Z")).dailyLimit).toBe(5); // day 4
    expect(getWarmupPhase(start, new Date("2026-01-30T00:00:00Z")).dailyLimit).toBe(50); // day 29+
  });
});

describe("canSendEmail", () => {
  const now = new Date("2026-01-10T12:00:00Z");

  it("allows a fresh account with no prior sends", () => {
    expect(canSendEmail({ warmupStartedAt: null, dailySendCount: 0, lastSentAt: null }, now)).toEqual({ allowed: true });
  });

  it("denies once the daily limit is reached", () => {
    const result = canSendEmail({ warmupStartedAt: null, dailySendCount: 3, lastSentAt: null }, now);
    expect(result.allowed).toBe(false);
  });

  it("enforces minimum spacing between sends regardless of daily count", () => {
    const lastSentAt = new Date(now.getTime() - 5 * 60_000); // 5 minutes ago
    const result = canSendEmail({ warmupStartedAt: null, dailySendCount: 0, lastSentAt }, now);
    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error("unreachable");
    expect(result.reason).toMatch(/Too soon/);
  });

  it("allows once enough time has passed since the last send", () => {
    const lastSentAt = new Date(now.getTime() - 30 * 60_000); // 30 minutes ago
    expect(canSendEmail({ warmupStartedAt: null, dailySendCount: 0, lastSentAt }, now)).toEqual({ allowed: true });
  });
});
