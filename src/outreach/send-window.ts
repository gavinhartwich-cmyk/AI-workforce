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
  startHour: 8,
  endHour: 18,
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
