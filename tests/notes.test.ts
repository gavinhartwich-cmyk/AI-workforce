import { describe, expect, it } from "vitest";
import { appendNote } from "../src/outreach/notes.js";

describe("appendNote", () => {
  it("starts a fresh notes field with a single timestamped line when there are no existing notes", () => {
    const result = appendNote(null, "Closed lost — not interested", new Date("2026-01-07T16:00:00Z"));
    expect(result).toBe("[2026-01-07T16:00:00.000Z] Closed lost — not interested");
  });

  it("appends a new timestamped line below any existing notes, leaving them untouched", () => {
    const existing = "[2026-01-01T00:00:00.000Z] Gavin: called, left voicemail";
    const result = appendNote(existing, "Escalated to Gavin — PRICE", new Date("2026-01-07T16:00:00Z"));
    expect(result).toBe(
      "[2026-01-01T00:00:00.000Z] Gavin: called, left voicemail\n[2026-01-07T16:00:00.000Z] Escalated to Gavin — PRICE"
    );
  });

  it("defaults to the current time when none is given", () => {
    const before = Date.now();
    const result = appendNote(null, "note");
    const after = Date.now();
    const match = result.match(/^\[(.+)\] note$/);
    expect(match).not.toBeNull();
    const timestamp = new Date(match![1]).getTime();
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });
});
