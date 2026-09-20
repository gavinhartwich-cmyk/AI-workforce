import { describe, expect, it } from "vitest";
import { decideReplyAction } from "../src/outreach/reply-routing.js";

describe("decideReplyAction", () => {
  it("suppresses on STOP_CONTACT, no reply", () => {
    expect(decideReplyAction("STOP_CONTACT", 95, false)).toEqual({ action: "suppress" });
  });

  it("takes no action on an out-of-office auto-responder", () => {
    expect(decideReplyAction("OUT_OF_OFFICE", 95, false)).toEqual({ action: "no_action" });
  });

  it("escalates PRICE and HOSTILE — never an autonomous reply", () => {
    expect(decideReplyAction("PRICE", 95, false)).toEqual({ action: "escalate" });
    expect(decideReplyAction("HOSTILE", 95, false)).toEqual({ action: "escalate" });
  });

  it("closes the deal lost on a clear no or an existing solution", () => {
    expect(decideReplyAction("NOT_INTERESTED", 95, false)).toEqual({ action: "close_lost" });
    expect(decideReplyAction("ALREADY_HAS_SOLUTION", 95, false)).toEqual({ action: "close_lost" });
  });

  it("escalates a low-confidence UNKNOWN rather than guessing", () => {
    expect(decideReplyAction("UNKNOWN", 30, false)).toEqual({ action: "escalate" });
  });

  it("replies autonomously to a confident UNKNOWN", () => {
    expect(decideReplyAction("UNKNOWN", 80, false)).toEqual({ action: "autonomous_reply", useAppointmentAgent: false });
  });

  it("replies autonomously to routine classifications", () => {
    for (const c of ["INTERESTED", "QUESTION", "OBJECTION", "NOT_NOW", "WRONG_PERSON", "REFERRAL"] as const) {
      expect(decideReplyAction(c, 90, false)).toEqual({ action: "autonomous_reply", useAppointmentAgent: false });
    }
  });

  it("routes to the Appointment Agent when appointment intent is present", () => {
    expect(decideReplyAction("INTERESTED", 90, true)).toEqual({ action: "autonomous_reply", useAppointmentAgent: true });
  });
});
