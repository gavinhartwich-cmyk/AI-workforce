import type { OptOutStore } from "./opt-out-store.js";
import type { OutreachControlStore } from "./outreach-control-store.js";
import type { EmailAccountsStore } from "../db/hartwich-os/email-accounts-store.js";
import { isWithinSendingWindow, type SendWindowConfig } from "./send-window.js";
import { selectAvailableAccount } from "./account-selector.js";

export type SendGuardResult =
  | { allowed: true; accountIndex: 0 | 1 | 2 }
  | { allowed: false; reason: string; permanent: boolean };

/**
 * The "properly handled" gate every autonomous send passes through
 * (Gavin, 2026-09-XX), shared by both the cold-outreach and follow-up
 * pipelines so neither can drift out of sync on what "properly handled"
 * means. In order:
 *
 *   1. opt-out (permanent — never retry)
 *   2. the kill switch (Gavin's "stop this campaign" lever, SPEC.md §57)
 *   3. sending window (business hours, not 3am)
 *   4. warm-up rate limit across the 3 rotating accounts
 *
 * A `false` result with `permanent: false` means "not right now" — the
 * caller just doesn't send on this run; nothing needs to remember to
 * retry, since the next scheduled run naturally tries again (same pattern
 * hartwich-os's own cron jobs use).
 */
export async function checkSendAllowed(
  deps: { optOuts: OptOutStore; control: OutreachControlStore; accounts: EmailAccountsStore },
  email: string,
  now: Date = new Date(),
  sendWindow?: SendWindowConfig
): Promise<SendGuardResult> {
  if (await deps.optOuts.isSuppressed(email)) {
    return { allowed: false, reason: `${email} is on the opt-out list.`, permanent: true };
  }

  const controlState = await deps.control.getState();
  if (controlState.sendingPaused) {
    return {
      allowed: false,
      reason: `Sending is paused${controlState.pausedReason ? `: ${controlState.pausedReason}` : "."}`,
      permanent: false,
    };
  }

  if (!isWithinSendingWindow(now, sendWindow)) {
    return { allowed: false, reason: "Outside the configured sending window.", permanent: false };
  }

  const states = await Promise.all([0, 1, 2].map((i) => deps.accounts.getState(i as 0 | 1 | 2)));
  const selection = selectAvailableAccount(states, now);
  if (!selection) {
    return { allowed: false, reason: "No sending account has warm-up capacity right now.", permanent: false };
  }

  return { allowed: true, accountIndex: selection.accountIndex };
}
