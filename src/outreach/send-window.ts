/**
 * Sending window — part of "properly handled": a cold email at 3am local
 * time reads as bot behavior even if every other check passes. Not a
 * spec-mandated table, just a sensible compliance-adjacent default,
 * configurable like everything else in src/outreach/.
 */
export type SendWindowConfig = {
  timezone: string;
  /** 0 = Sunday ... 6 = Saturday. */
  workingDays: number[];
  startHour: number; // 24h, local to `timezone`
  endHour: number;
};

export const DEFAULT_SEND_WINDOW: SendWindowConfig = {
  timezone: "America/Winnipeg",
  workingDays: [1, 2, 3, 4, 5],
  startHour: 5,
  // Exclusive: the last send goes out at 22:59, so nothing sends at or
  // after 11pm. Widened from 8-18 to 5-23 (Gavin, 2026-09-10) — the
  // window's job is to keep sends off the 3am graveyard shift that reads
  // as bot behavior, not to mirror office hours, and a wider window gives
  // the 25-minute send spacing more room to place a day's worth of sends
  // without bunching them up.
  endHour: 23,
};

export function isWithinSendingWindow(now: Date, config: SendWindowConfig = DEFAULT_SEND_WINDOW): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: config.timezone,
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(now);

  const weekdayStr = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "0";
  // Intl can format midnight as "24" with hour12:false in some environments.
  const hour = Number(hourStr) % 24;

  const dayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayStr);

  return config.workingDays.includes(dayIndex) && hour >= config.startHour && hour < config.endHour;
}
