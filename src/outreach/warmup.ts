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

const WINNIPEG_TIMEZONE = "America/Winnipeg";

/**
 * Midnight (Winnipeg local) on whatever Winnipeg date `at` falls on, as a
 * real UTC instant. Mirrors hartwich-os's getTodayMidnightWinnipeg — both
 * repos must agree on where a "sending day" starts or they'd advance the
 * shared ramp counter at different moments.
 */
function todayMidnightWinnipeg(at: Date): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: WINNIPEG_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const utcMidnightCandidate = Date.UTC(get("year"), get("month") - 1, get("day"), 0, 0, 0);

  const offsetParts = new Intl.DateTimeFormat("en-US", {
    timeZone: WINNIPEG_TIMEZONE,
    timeZoneName: "shortOffset",
  }).formatToParts(new Date(utcMidnightCandidate));
  const raw = offsetParts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
  const match = raw.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  const offsetMinutes = match
    ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] ?? 0))
    : 0;
  return new Date(utcMidnightCandidate - offsetMinutes * 60_000);
}

/** Whether a send at `at` is this mailbox's first of that Winnipeg day. */
export function startsNewSendDay(lastSentAt: Date | null, at: Date = new Date()): boolean {
  if (!lastSentAt) return true;
  return lastSentAt.getTime() < todayMidnightWinnipeg(at).getTime();
}

/**
 * Ramp position by *sending* days rather than elapsed calendar days — an
 * idle mailbox builds no reputation, so it must not graduate to a higher
 * cap. `activeSendDays` counts today once it has sent, so the tier keys off
 * days completed before today.
 */
export function getWarmupPhase(activeSendDays: number): { activeSendDays: number; dailyLimit: number } {
  const days = Math.max(0, activeSendDays);
  const completedDays = Math.max(0, days - 1);

  let dailyLimit = WARMUP_RAMP[0].dailyLimit;
  for (const tier of WARMUP_RAMP) {
    if (completedDays >= tier.fromDay) dailyLimit = tier.dailyLimit;
  }
  return { activeSendDays: days, dailyLimit };
}

export type SendPermission = { allowed: true } | { allowed: false; reason: string };

export function canSendEmail(
  state: { activeSendDays: number; dailySendCount: number; lastSentAt: Date | null },
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

  // A mailbox that hasn't sent today is about to start a new sending day, so
  // hold it to that upcoming day's cap rather than the finished one's.
  const effectiveDays = state.activeSendDays + (startsNewSendDay(state.lastSentAt, now) ? 1 : 0);
  const { dailyLimit } = getWarmupPhase(effectiveDays);
  if (state.dailySendCount >= dailyLimit) {
    return { allowed: false, reason: `Daily limit reached (${dailyLimit}/day). Sent ${state.dailySendCount} today.` };
  }

  return { allowed: true };
}
