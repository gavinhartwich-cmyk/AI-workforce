/**
 * Follow-up cadence — same 3/6/9-day intervals as hartwich-os's own
 * src/lib/emails/cadence.ts, capped at maxFollowUps (from
 * approved-messaging-config.ts). Pure — no DB, no clock other than what's
 * passed in.
 */
export type FollowUpCandidate = {
  dealId: string;
  lastOutboundEmailAt: Date;
  lastInboundEmailAt: Date | null;
  followUpCount: number;
};

const FOLLOW_UP_INTERVAL_DAYS = 3;

function daysSince(at: Date, now: Date): number {
  return (now.getTime() - at.getTime()) / (1000 * 60 * 60 * 24);
}

export function isFollowUpDue(candidate: FollowUpCandidate, now: Date, maxFollowUps: number): boolean {
  if (candidate.followUpCount >= maxFollowUps) return false;

  // A reply already came in since the last send — not a cadence candidate.
  if (candidate.lastInboundEmailAt && candidate.lastInboundEmailAt >= candidate.lastOutboundEmailAt) return false;

  const threshold = (candidate.followUpCount + 1) * FOLLOW_UP_INTERVAL_DAYS;
  return daysSince(candidate.lastOutboundEmailAt, now) >= threshold;
}
