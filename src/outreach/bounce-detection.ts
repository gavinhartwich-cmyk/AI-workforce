/**
 * Detects a Gmail bounce/delivery-failure notification so it's never
 * treated as a genuine reply. Ported from hartwich-os's own
 * src/lib/emails/sync-replies.ts (isBounceNotification) — same heuristic,
 * kept in sync deliberately rather than re-derived, since both repos poll
 * the same 3 mailboxes and disagreeing on what counts as a bounce is
 * exactly how a bounce ends up mis-marked "Engaged" in one system while
 * the other correctly flags it.
 *
 * 2026-09-17: the first version of this (literal substrings — "delivery
 * status notification", "mail delivery failed", ...) caught the specific
 * DSN wording Gmail happened to use for the bounce that prompted it, and
 * then missed the next real bounce because it used different wording for
 * the same failure. A list of literal phrases will always be one exact
 * phrase behind whatever an MTA actually sends. BOUNCE_SUBJECT_RE below
 * is a single regex built from the handful of *word roots* every bounce
 * notification's subject shares (deliver/undeliver/bounce/fail/reject/
 * block/return, each within a short distance of the other) instead — it
 * matches "Delivery Status Notification (Failure)", "Undeliverable: ...",
 * "Delivery has failed to these recipients" (Exchange/Outlook), "Message
 * blocked", "Returned mail: see transcript", etc. without needing a new
 * literal added every time a different mail server phrases it slightly
 * differently.
 *
 * A *temporary* delay notice ("will retry", "delivery incomplete") is
 * deliberately NOT treated as a permanent failure here — same reasoning
 * as hartwich-os's own comment: flagging it would send the deal for
 * address-correction before Gmail has even given up retrying. It's still
 * not a real reply, though, so the caller must still skip it as a
 * duplicate/no-op — see src/pipelines/handle-inbound-replies.ts.
 */
const BOUNCE_ADDRESS_PREFIXES = ["mailer-daemon@", "mailer_daemon@", "mail-daemon@", "postmaster@"];

const BOUNCE_SUBJECT_RE =
  /delivery status notification|undeliver(ed|able)|delivery.{0,15}(fail|incomplete|problem|error)|(fail|reject|block).{0,15}(deliver|mail|message)|mail delivery failed|returned to sender|returned mail|failure notice|message (not delivered|rejected|blocked)|could ?n'?t be delivered|permanently fail/;

export function isBounceNotification(fromAddress: string, subject: string | null): boolean {
  const from = fromAddress.toLowerCase();
  const s = (subject ?? "").toLowerCase();

  if (BOUNCE_ADDRESS_PREFIXES.some((prefix) => from.startsWith(prefix))) return true;
  return BOUNCE_SUBJECT_RE.test(s);
}

/** A temporary "still retrying" notice, as opposed to a final failure — see isBounceNotification's own note. */
export function isTemporaryDelayNotice(subject: string | null): boolean {
  const s = (subject ?? "").toLowerCase();
  return /\bdelay(ed)?\b|incomplete|will retry|temporar(y|ily)/.test(s);
}
