import { eq } from "drizzle-orm";
import { getHartwichOsDb } from "./client.js";
import { emailSendAccounts } from "./schema.js";

export type EmailAccountState = {
  accountIndex: 0 | 1 | 2;
  warmupStartedAt: Date | null;
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
    if (!row) return { accountIndex, warmupStartedAt: null, dailySendCount: 0, lastSentAt: null };

    // Daily counter resets whenever the last reset predates today (UTC —
    // hartwich-os's own version resets at Winnipeg midnight; this repo
    // doesn't need to match that exactly, just avoid double-counting
    // across real days).
    const today = startOfTodayUtc(new Date());
    const countResetNeeded = !row.lastSendResetAt || row.lastSendResetAt < today;

    return {
      accountIndex,
      warmupStartedAt: row.warmupStartedAt,
      dailySendCount: countResetNeeded ? 0 : row.dailySendCount,
      lastSentAt: row.lastSentAt,
    };
  }

  async recordSend(accountIndex: 0 | 1 | 2, at: Date): Promise<void> {
    const db = getHartwichOsDb();
    const state = await this.getState(accountIndex);

    await db
      .insert(emailSendAccounts)
      .values({
        accountIndex,
        warmupStatus: "warming_up",
        warmupStartedAt: state.warmupStartedAt ?? at,
        dailySendCount: state.dailySendCount + 1,
        lastSendResetAt: startOfTodayUtc(at),
        lastSentAt: at,
        updatedAt: at,
      })
      .onConflictDoUpdate({
        target: emailSendAccounts.accountIndex,
        set: {
          warmupStartedAt: state.warmupStartedAt ?? at,
          dailySendCount: state.dailySendCount + 1,
          lastSendResetAt: startOfTodayUtc(at),
          lastSentAt: at,
          updatedAt: at,
        },
      });
  }
}
