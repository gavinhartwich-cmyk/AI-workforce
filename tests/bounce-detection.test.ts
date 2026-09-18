import { describe, expect, it } from "vitest";
import { isBounceNotification, isTemporaryDelayNotice } from "../src/outreach/bounce-detection.js";

describe("isBounceNotification", () => {
  it("catches the standard Gmail mailer-daemon DSN", () => {
    expect(isBounceNotification("mailer-daemon@googlemail.com", "Delivery Status Notification (Failure)")).toBe(true);
  });

  it("catches a postmaster bounce", () => {
    expect(isBounceNotification("postmaster@some-domain.com", "failure notice")).toBe(true);
  });

  it("catches mail-daemon and mailer_daemon address variants", () => {
    expect(isBounceNotification("mail-daemon@example.com", "")).toBe(true);
    expect(isBounceNotification("mailer_daemon@example.com", "")).toBe(true);
  });

  // The exact real-world gap this test suite didn't have coverage for
  // before: an Exchange/Outlook-style bounce, which uses neither a
  // mailer-daemon/postmaster address nor any of the original literal
  // phrases ("delivery status notification", "mail delivery failed", ...).
  it("catches an Exchange/Outlook-style 'Undeliverable:' bounce from an arbitrary sender address", () => {
    expect(
      isBounceNotification(
        "microsoftexchange329e71ec52ee4@some-hvac-company.com",
        "Undeliverable: Quick question about your Google reviews"
      )
    ).toBe(true);
  });

  it("catches 'Delivery has failed to these recipients' (Exchange group-bounce wording)", () => {
    expect(isBounceNotification("postmaster@some-domain.com", "Delivery has failed to these recipients or groups:")).toBe(true);
  });

  it("catches 'Message blocked' / 'Message rejected'", () => {
    expect(isBounceNotification("mailer-daemon@some-host.com", "Message blocked")).toBe(true);
    expect(isBounceNotification("mailer-daemon@some-host.com", "Message rejected")).toBe(true);
  });

  it("catches 'Returned mail: see transcript for details'", () => {
    expect(isBounceNotification("mailer-daemon@some-host.com", "Returned mail: see transcript for details")).toBe(true);
  });

  it("still catches every subject the original literal-string version covered", () => {
    const subjects = [
      "Delivery Status Notification (Failure)",
      "Undelivered Mail Returned to Sender",
      "Delivery Failure",
      "Mail delivery failed: returning message to sender",
      "Returned to sender",
      "Undeliverable",
    ];
    for (const subject of subjects) {
      expect(isBounceNotification("some-mta@example.com", subject)).toBe(true);
    }
  });

  it("does not flag a genuine reply as a bounce", () => {
    expect(isBounceNotification("info@example-hvac.test", "Re: Quick question about your Google reviews")).toBe(false);
    expect(isBounceNotification("info@example-hvac.test", "Interested, tell me more")).toBe(false);
  });
});

describe("isTemporaryDelayNotice", () => {
  it("recognizes a still-retrying DSN as temporary, not a final failure", () => {
    expect(isTemporaryDelayNotice("Delivery Status Notification (Delay)")).toBe(true);
    expect(isTemporaryDelayNotice("Delivery incomplete — will retry")).toBe(true);
  });

  it("does not call a final failure notice temporary", () => {
    expect(isTemporaryDelayNotice("Delivery Status Notification (Failure)")).toBe(false);
  });
});
