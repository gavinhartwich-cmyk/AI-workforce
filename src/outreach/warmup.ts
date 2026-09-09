/**
 * Email warm-up/rate-limit rules — ported from hartwich-os's own
 * src/lib/warmup/schedule.ts (its proven, already-tuned ramp), not
 * reinvented, since this repo sends from the SAME physical Gmail accounts
 * (src/db/hartwich-os/email-accounts-store.ts shares their state table).
 * Deliberately kept in sync by hand rather than imported — these are two
 * separate repos (Gavin, 2026-09-09).
 *
 * This is the deterministic half of "properly handled" autonomous sending:
 * a daily cap per account (so reputation ramps up gradually, not day-one
 * blasting) plus a minimum spacing between any two sends (so a burst of
 * outreach in two minutes doesn't read as bot behavior even under the cap).
 */

const WARMUP_RAMP: { fromDay: number; dailyLimit: number }[] = [
  { fromDay: 0, dailyLimit: 3 },
  { fromDay: 4, dailyLimit: 5 },
  { fromDay: 8, dailyLimit: 10 },
  { fromDay: 15, dailyLimit: 20 },
  { fromDay: 22, dailyLimit: 35 },
  { fromDay: 29, dailyLimit: 50 },
];

const MIN_SEND_SPACING_MINUTES = 25;

export function getWarmupPhase(startedAt: Date | null, now: Date = new Date()): { daysSinceStart: number; dailyLimit: number } {
  if (!startedAt) return { daysSinceStart: 0, dailyLimit: WARMUP_RAMP[0].dailyLimit };

  const daysSinceStart = Math.floor((now.getTime() - startedAt.getTime()) / (1000 * 60 * 60 * 24));
  let dailyLimit = WARMUP_RAMP[0].dailyLimit;
  for (const tier of WARMUP_RAMP) {
    if (daysSinceStart >= tier.fromDay) dailyLimit = tier.dailyLimit;
  }
  return { daysSinceStart, dailyLimit };
}

export type SendPermission = { allowed: true } | { allowed: false; reason: string };

export function canSendEmail(
  state: { warmupStartedAt: Date | null; dailySendCount: number; lastSentAt: Date | null },
  now: Date = new Date()
): SendPermission {
  if (state.lastSentAt) {
    const minutesSinceLastSend = (now.getTime() - state.lastSentAt.getTime()) / 60_000;
    if (minutesSinceLastSend < MIN_SEND_SPACING_MINUTES) {
      return {
        allowed: false,
        reason: `Too soon since last send — wait ${Math.ceil(MIN_SEND_SPACING_MINUTES - minutesSinceLastSend)} more minute(s).`,
      };
    }
  }

  const { dailyLimit } = getWarmupPhase(state.warmupStartedAt, now);
  if (state.dailySendCount >= dailyLimit) {
    return { allowed: false, reason: `Daily limit reached (${dailyLimit}/day). Sent ${state.dailySendCount} today.` };
  }

  return { allowed: true };
}
