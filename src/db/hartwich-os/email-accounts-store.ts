import { eq } from "drizzle-orm";
import { getHartwichOsDb } from "./client.js";
import { emailSendAccounts } from "./schema.js";
import { startsNewSendDay } from "../../outreach/warmup.js";

export type EmailAccountState = {
  accountIndex: 0 | 1 | 2;
  warmupStartedAt: Date | null;
  /** Distinct days this mailbox has actually sent on — what the ramp keys off. */
  activeSendDays: number;
  dailySendCount: number;
  lastSentAt: Date | null;
};

/**
 * Reads/writes hartwich-os's own `email_send_accounts` table — the SAME
 * warm-up state hartwich-os's own sending code uses for these 3 Gmail
 * accounts (see src/outreach/warmup.ts's header comment for why this has
 * to be shared, not a separate counter).
 */
export interface EmailAccountsStore {
  getState(accountIndex: 0 | 1 | 2): Promise<EmailAccountState>;
  recordSend(accountIndex: 0 | 1 | 2, at: Date): Promise<void>;
}

function startOfTodayUtc(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

export class PostgresEmailAccountsStore implements EmailAccountsStore {
  async getState(accountIndex: 0 | 1 | 2): Promise<EmailAccountState> {
    const db = getHartwichOsDb();
    const row = await db.query.emailSendAccounts.findFirst({
      where: eq(emailSendAccounts.accountIndex, accountIndex),
    });
    if (!row) return { accountIndex, warmupStartedAt: null, activeSendDays: 0, dailySendCount: 0, lastSentAt: null };

    // Daily counter resets whenever the last reset predates today (UTC —
    // hartwich-os's own version resets at Winnipeg midnight; this repo
    // doesn't need to match that exactly, just avoid double-counting
    // across real days).
    const today = startOfTodayUtc(new Date());
    const countResetNeeded = !row.lastSendResetAt || row.lastSendResetAt < today;

    return {
      accountIndex,
      warmupStartedAt: row.warmupStartedAt,
      activeSendDays: row.activeSendDays,
      dailySendCount: countResetNeeded ? 0 : row.dailySendCount,
      lastSentAt: row.lastSentAt,
    };
  }

  async recordSend(accountIndex: 0 | 1 | 2, at: Date): Promise<void> {
    const db = getHartwichOsDb();
    const state = await this.getState(accountIndex);

    // The warm-up ramp advances per *sending* day, so only the day's first
    // send moves it. Uses the Winnipeg boundary hartwich-os's own sending
    // path uses — both write this same counter, so they have to agree on
    // where a day starts or one of them would double-count.
    const activeSendDays = state.activeSendDays + (startsNewSendDay(state.lastSentAt, at) ? 1 : 0);

    await db
      .insert(emailSendAccounts)
      .values({
        accountIndex,
        warmupStatus: "warming_up",
        warmupStartedAt: state.warmupStartedAt ?? at,
        activeSendDays,
        dailySendCount: state.dailySendCount + 1,
        lastSendResetAt: startOfTodayUtc(at),
        lastSentAt: at,
        updatedAt: at,
      })
      .onConflictDoUpdate({
        target: emailSendAccounts.accountIndex,
        set: {
          warmupStartedAt: state.warmupStartedAt ?? at,
          activeSendDays,
          dailySendCount: state.dailySendCount + 1,
          lastSendResetAt: startOfTodayUtc(at),
          lastSentAt: at,
          updatedAt: at,
        },
      });
  }
}
