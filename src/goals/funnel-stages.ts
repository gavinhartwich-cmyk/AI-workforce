import type { FunnelReader } from "../db/hartwich-os/funnel-reader.js";
import type { FunnelStageVolume, Period } from "./types.js";

/**
 * The funnel stages this repo can actually observe, using hartwich-os's
 * real pipeline stage names (New Lead/Contacted/Engaged/Meeting Booked/
 * Proposal Sent/Won — see hartwich-os's src/db/seed.ts) rather than
 * SPEC.md §13's more abstract 9-stage funnel (which includes "Replies,"
 * "Positive Replies," and "Shows" as separate steps hartwich-os's pipeline
 * doesn't model as distinct stages). "New Lead" is skipped: a deal is
 * created directly into it at qualification time (src/pipelines/discover-
 * research-qualify.ts), so its volume is redundant with qualified_prospects.
 *
 * Caveat, since hartwich-os has no stage-history table: a stage's volume
 * here is "deals whose CURRENT stage is X and entered it during this
 * period," not "deals that ever passed through X" — a deal that advanced
 * to Proposal Sent already stops counting toward Contacted/Engaged, even
 * though it passed through both. Good enough for "where is the funnel
 * breaking right now," not a perfect historical reconstruction.
 */
export const FUNNEL_STAGE_ORDER = [
  "prospects_discovered",
  "qualified_prospects",
  "contacted",
  "engaged",
  "meeting_booked",
  "proposal_sent",
  "won",
] as const;

export async function getFunnelStageVolumes(period: Period, funnel: FunnelReader): Promise<FunnelStageVolume[]> {
  const [prospects, qualified, contacted, engaged, meetingBooked, proposalSent, won] = await Promise.all([
    funnel.countCompaniesCreated(period),
    funnel.countCompaniesByStatus("qualified", period),
    funnel.countDealsByStageName("Contacted", period),
    funnel.countDealsByStageName("Engaged", period),
    funnel.countDealsByStageName("Meeting Booked", period),
    funnel.countDealsByStageName("Proposal Sent", period),
    funnel.countDealsWon(period),
  ]);

  return [
    { stage: "prospects_discovered", volume: prospects },
    { stage: "qualified_prospects", volume: qualified },
    { stage: "contacted", volume: contacted },
    { stage: "engaged", volume: engaged },
    { stage: "meeting_booked", volume: meetingBooked },
    { stage: "proposal_sent", volume: proposalSent },
    { stage: "won", volume: won },
  ];
}

/**
 * Configurable, documented estimates (SPEC.md §9: "configurable fallback
 * assumptions when data is insufficient" — "the manager must continually
 * replace estimates with real data"). These are rough cold-B2B-outreach
 * ballparks, not Hartwich-specific history — there isn't enough of that
 * yet. Replace per key as real conversion data accumulates.
 */
export const DEFAULT_TARGET_CONVERSION_RATES: Record<string, number> = {
  "prospects_discovered->qualified_prospects": 0.5,
  "qualified_prospects->contacted": 0.9,
  "contacted->engaged": 0.15,
  "engaged->meeting_booked": 0.3,
  "meeting_booked->proposal_sent": 0.6,
  "proposal_sent->won": 0.3,
};
