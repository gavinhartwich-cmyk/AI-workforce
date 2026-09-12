import { describe, expect, it } from "vitest";
import { isFollowUpDue } from "../src/outreach/followup-cadence.js";

const now = new Date("2026-01-10T12:00:00Z");
const maxFollowUps = 3;

function daysAgo(n: number): Date {
  return new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
}

describe("isFollowUpDue", () => {
  it("is not due before the 3-day threshold for the first follow-up", () => {
    expect(isFollowUpDue({ dealId: "d1", lastOutboundEmailAt: daysAgo(2), lastInboundEmailAt: null, followUpCount: 0 }, now, maxFollowUps)).toBe(false);
  });

  it("is due once the threshold passes", () => {
    expect(isFollowUpDue({ dealId: "d1", lastOutboundEmailAt: daysAgo(3), lastInboundEmailAt: null, followUpCount: 0 }, now, maxFollowUps)).toBe(true);
  });

  it("uses an increasing threshold for later follow-ups (3, 6, 9 days)", () => {
    // Follow-up #2 needs 6 days since the last send.
    expect(isFollowUpDue({ dealId: "d1", lastOutboundEmailAt: daysAgo(5), lastInboundEmailAt: null, followUpCount: 1 }, now, maxFollowUps)).toBe(false);
    expect(isFollowUpDue({ dealId: "d1", lastOutboundEmailAt: daysAgo(6), lastInboundEmailAt: null, followUpCount: 1 }, now, maxFollowUps)).toBe(true);
  });

  it("stops once maxFollowUps is reached", () => {
    expect(isFollowUpDue({ dealId: "d1", lastOutboundEmailAt: daysAgo(30), lastInboundEmailAt: null, followUpCount: 3 }, now, maxFollowUps)).toBe(false);
  });

  it("stops once a reply has come in", () => {
    expect(
      isFollowUpDue(
        { dealId: "d1", lastOutboundEmailAt: daysAgo(5), lastInboundEmailAt: daysAgo(4), followUpCount: 0 },
        now,
        maxFollowUps
      )
    ).toBe(false);
  });
});
