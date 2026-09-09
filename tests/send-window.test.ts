import { describe, expect, it } from "vitest";
import { isWithinSendingWindow, DEFAULT_SEND_WINDOW } from "../src/outreach/send-window.js";

// Winnipeg is UTC-6 in January (standard time, no DST).
describe("isWithinSendingWindow", () => {
  it("allows a weekday during business hours", () => {
    // Wed 2026-01-07, 10:00 Winnipeg = 16:00 UTC
    expect(isWithinSendingWindow(new Date("2026-01-07T16:00:00Z"))).toBe(true);
  });

  it("denies a weekend", () => {
    // Sat 2026-01-10, 10:00 Winnipeg = 16:00 UTC
    expect(isWithinSendingWindow(new Date("2026-01-10T16:00:00Z"))).toBe(false);
  });

  it("denies outside business hours on a weekday", () => {
    // Wed 2026-01-07, 20:00 Winnipeg = 02:00 UTC on Jan 8 — still "Wed" locally? Use a clearly-late local hour instead.
    // Tue 2026-01-06, 22:00 Winnipeg = 2026-01-07T04:00:00Z
    expect(isWithinSendingWindow(new Date("2026-01-07T04:00:00Z"))).toBe(false);
  });

  it("respects a custom config", () => {
    const weekendConfig = { ...DEFAULT_SEND_WINDOW, workingDays: [6] }; // Saturday only
    expect(isWithinSendingWindow(new Date("2026-01-10T16:00:00Z"), weekendConfig)).toBe(true);
    expect(isWithinSendingWindow(new Date("2026-01-07T16:00:00Z"), weekendConfig)).toBe(false);
  });
});
