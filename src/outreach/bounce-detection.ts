/**
 * Detects a Gmail bounce/delivery-failure notification so it's never
 * treated as a genuine reply. Ported from hartwich-os's own
 * src/lib/emails/sync-replies.ts (isBounceNotification) — same heuristic,
 * kept in sync deliberately rather than re-derived, since both repos poll
 * the same 3 mailboxes and disagreeing on what counts as a bounce is
 * exactly how a bounce ends up mis-marked "Engaged" in one system while
 * the other correctly flags it.
 *
 * A *temporary* delay notice ("will retry", "delivery incomplete") is
 * deliberately NOT treated as a bounce here — same reasoning as
 * hartwich-os's own comment: flagging it would send the deal for
 * address-correction before Gmail has even given up retrying. It's still
 * not a real reply, though, so the caller must still skip it as a
 * duplicate/no-op — see src/pipelines/handle-inbound-replies.ts.
 */
export function isBounceNotification(fromAddress: string, subject: string | null): boolean {
  const from = fromAddress.toLowerCase();
  const s = (subject ?? "").toLowerCase();

  if (from.startsWith("mailer-daemon@") || from.startsWith("postmaster@")) return true;
  return (
    s.includes("delivery status notification") ||
    s.includes("undelivered mail") ||
    s.includes("delivery failure") ||
    s.includes("mail delivery failed") ||
    s.includes("returned to sender") ||
    s.includes("undeliverable")
  );
}

/** A temporary "still retrying" notice, as opposed to a final failure — see isBounceNotification's own note. */
export function isTemporaryDelayNotice(subject: string | null): boolean {
  const s = (subject ?? "").toLowerCase();
  return /\bdelay(ed)?\b|incomplete|will retry|temporar(y|ily)/.test(s);
}
