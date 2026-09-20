import { canSendEmail } from "./warmup.js";
import type { EmailAccountState } from "../db/hartwich-os/email-accounts-store.js";

export type AccountSelection = { accountIndex: 0 | 1 | 2 } | null;

/** First account (in order) with warm-up capacity right now — pure, testable independent of the DB. */
export function selectAvailableAccount(states: EmailAccountState[], now: Date = new Date()): AccountSelection {
  for (const state of states) {
    if (canSendEmail(state, now).allowed) return { accountIndex: state.accountIndex };
  }
  return null;
}
