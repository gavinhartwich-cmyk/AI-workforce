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

  it("denies the small hours on a weekday", () => {
    // Wed 2026-01-07, 03:00 Winnipeg = 09:00 UTC — before the 5am open.
    expect(isWithinSendingWindow(new Date("2026-01-07T09:00:00Z"))).toBe(false);
  });

  // Boundaries of the 5am-11pm window (Winnipeg is UTC-6 in January).
  it("allows the 5am open and the last hour before 11pm", () => {
    // Wed 2026-01-07, 05:00 Winnipeg = 11:00 UTC
    expect(isWithinSendingWindow(new Date("2026-01-07T11:00:00Z"))).toBe(true);
    // Wed 2026-01-07, 22:30 Winnipeg = 2026-01-08T04:30 UTC
    expect(isWithinSendingWindow(new Date("2026-01-08T04:30:00Z"))).toBe(true);
  });

  it("denies 11pm onward", () => {
    // Wed 2026-01-07, 23:00 Winnipeg = 2026-01-08T05:00 UTC — endHour is exclusive.
    expect(isWithinSendingWindow(new Date("2026-01-08T05:00:00Z"))).toBe(false);
    // Thu 2026-01-08, 04:00 Winnipeg = 10:00 UTC
    expect(isWithinSendingWindow(new Date("2026-01-08T10:00:00Z"))).toBe(false);
  });

  it("respects a custom config", () => {
    const weekendConfig = { ...DEFAULT_SEND_WINDOW, workingDays: [6] }; // Saturday only
    expect(isWithinSendingWindow(new Date("2026-01-10T16:00:00Z"), weekendConfig)).toBe(true);
    expect(isWithinSendingWindow(new Date("2026-01-07T16:00:00Z"), weekendConfig)).toBe(false);
  });
});
