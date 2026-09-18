/**
 * Mirrors hartwich-os's own normalizeCompanyName/websiteDomain
 * (hartwich-os/src/lib/data/companies.ts) exactly — same dedupe rule, so a
 * candidate this repo's Discovery pipeline finds is judged a duplicate (or
 * not) by the identical logic hartwich-os's own lead-mining flow uses. Keep
 * these two in sync with that file if it ever changes.
 */

export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\b(llc|inc|incorporated|co|corp|corporation|company|ltd)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function websiteDomain(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}
