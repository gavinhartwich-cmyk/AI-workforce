/**
 * Where the Sales Manager's autonomous "increase discovery volume"
 * intervention (src/manager/sales-manager.ts) actually searches. Hardcoded
 * to Hartwich's real ICP on purpose (Gavin, 2026-09-09: "the ICP is
 * hardcoded for HVAC because that's who we service") — this is
 * configuration, not a gap, same note src/qualification/scoring.ts's own
 * config carries.
 */
export type DiscoveryTarget = { area: string; keyword: string };

export const DEFAULT_DISCOVERY_TARGETS: DiscoveryTarget[] = [{ area: "Winnipeg, MB", keyword: "HVAC contractor" }];

/** Matches src/pipelines/discover-research-qualify.ts's own `maxResults` default — the manager scales up FROM this, not from an arbitrary number. */
export const BASE_DISCOVERY_VOLUME = 20;
