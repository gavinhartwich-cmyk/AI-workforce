/**
 * Where discovery actually searches. Hardcoded to Hartwich's real ICP on
 * purpose (Gavin, 2026-09-09: "the ICP is hardcoded for HVAC because
 * that's who we service") — this is configuration, not a gap, same note
 * src/qualification/scoring.ts's own config carries.
 *
 * Geography (Gavin, 2026-09-10): expanded from Winnipeg-only to all of
 * North America — HVAC demand is universal (heating in cold climates,
 * cooling in hot ones), so nothing in this list is excluded on that
 * basis. Major metros only, weighted toward higher population (more
 * HVAC contractors to find per search) and spread across every US/Canada
 * region rather than clustered in one.
 */
export type DiscoveryTarget = { area: string; keyword: string };

const KEYWORD = "HVAC contractor";

export const NORTH_AMERICA_DISCOVERY_TARGETS: DiscoveryTarget[] = [
  // Canada
  "Winnipeg, MB",
  "Toronto, ON",
  "Vancouver, BC",
  "Calgary, AB",
  "Edmonton, AB",
  "Ottawa, ON",
  "Montreal, QC",
  "Hamilton, ON",
  "Halifax, NS",
  "Saskatoon, SK",
  "Regina, SK",
  "Victoria, BC",
  "Quebec City, QC",
  "London, ON",
  "Kitchener, ON",
  // United States
  "New York, NY",
  "Los Angeles, CA",
  "Chicago, IL",
  "Houston, TX",
  "Phoenix, AZ",
  "Philadelphia, PA",
  "San Antonio, TX",
  "San Diego, CA",
  "Dallas, TX",
  "Austin, TX",
  "Jacksonville, FL",
  "Fort Worth, TX",
  "Columbus, OH",
  "Charlotte, NC",
  "San Francisco, CA",
  "Indianapolis, IN",
  "Seattle, WA",
  "Denver, CO",
  "Boston, MA",
  "Nashville, TN",
  "Oklahoma City, OK",
  "Portland, OR",
  "Las Vegas, NV",
  "Detroit, MI",
  "Memphis, TN",
  "Louisville, KY",
  "Baltimore, MD",
  "Milwaukee, WI",
  "Albuquerque, NM",
  "Tucson, AZ",
  "Fresno, CA",
  "Sacramento, CA",
  "Kansas City, MO",
  "Atlanta, GA",
  "Miami, FL",
  "Raleigh, NC",
  "Omaha, NE",
  "Minneapolis, MN",
  "Cleveland, OH",
  "Tampa, FL",
  "St. Louis, MO",
  "Pittsburgh, PA",
  "Cincinnati, OH",
  "Orlando, FL",
].map((area) => ({ area, keyword: KEYWORD }));

/** Matches src/pipelines/discover-research-qualify.ts's own `maxResults` default — the manager scales up FROM this, not from an arbitrary number. */
export const BASE_DISCOVERY_VOLUME = 20;

/**
 * How many metro areas one discovery cycle actually searches. Iterating
 * the full 60+-area North America list every cron run (hourly) would
 * multiply Google Places + website-fetch + Groq calls 60x per run — this
 * bounds the cost per cycle while still covering the whole continent
 * over time via rotation (see currentDiscoveryTargets below).
 */
export const AREAS_PER_CYCLE = 2;

/**
 * Deterministic time-based rotation through NORTH_AMERICA_DISCOVERY_TARGETS
 * — no persisted "where did we leave off" state needed. At AREAS_PER_CYCLE=2
 * and hourly cron, the full ~60-area list gets a fresh sweep roughly every
 * day and a half. Both src/cli/run-cycle.ts's regular discovery stage and
 * the Sales Manager's "increase discovery volume" intervention
 * (src/manager/sales-manager.ts) call this instead of iterating the raw
 * list directly.
 */
export function currentDiscoveryTargets(at: Date = new Date(), count = AREAS_PER_CYCLE): DiscoveryTarget[] {
  const hourIndex = Math.floor(at.getTime() / 3_600_000);
  const n = NORTH_AMERICA_DISCOVERY_TARGETS.length;
  return Array.from({ length: count }, (_, i) => NORTH_AMERICA_DISCOVERY_TARGETS[(hourIndex * count + i) % n]);
}
