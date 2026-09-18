/**
 * The "approved messaging system" (SPEC.md §20): the boundaries Outreach
 * Strategy/Generation operate inside of, as data — never improvised per
 * agent, never baked ad hoc into one prompt (SPEC.md §19: every
 * consequential decision goes through a defined boundary, not a model's
 * own judgment about what's allowed). Changing the pitch, tone rules, or
 * enabled channels is an edit here, not a prompt rewrite scattered across
 * agent files.
 *
 * SPEC.md §20 also lists "approved sending limits" as part of this
 * boundary — that's Phase 5's concern (hartwich-os's own warm-up ramp,
 * src/lib/warmup/schedule.ts, already exists there and this repo will
 * wrap it when Outreach Execution is built), not represented here since
 * Phase 4 never sends anything.
 */

export type ApprovedMessagingConfig = {
  /** What Hartwich Labs actually sells — the one true description every agent's pitch must trace back to. */
  offer: string;
  positioning: string;
  /** Channels this repo is allowed to draft for. Only email exists today — hartwich-os's only wired integration (Gmail). */
  enabledChannels: ("email" | "sms" | "linkedin")[];
  /** Absolute rules no draft may violate — enforced via the system prompt, same spirit as hartwich-os's own hard-won draft-outreach.ts rules. */
  hardRules: string[];
  maxFollowUps: number;
  cta: {
    maxCtasPerMessage: number;
    preferredCta: string;
  };
  wordCountRange: { min: number; max: number };
};

export const APPROVED_MESSAGING_CONFIG: ApprovedMessagingConfig = {
  offer:
    "Google review automation and reputation-management: helping HVAC service businesses systematically request, collect, and respond to Google reviews.",
  positioning:
    "A specific, one-off outreach from a real person who looked at this one business — never a templated pitch with the name swapped in.",
  enabledChannels: ["email"],
  hardRules: [
    "Never invent facts, numbers, statistics, testimonials, customer names, or claims about Hartwich Labs' own track record — Hartwich Labs is a new company with no such history to cite.",
    "Never fabricate urgency, a relationship, or a prior conversation that didn't happen.",
    "Never guarantee results, guaranteed rankings, or guaranteed review-count outcomes.",
    "Never address a prospect by an invented name — greet generically if no real contact name is known.",
    "Only reference research evidence that was actually provided — no guessing about a business beyond what's given.",
  ],
  maxFollowUps: 3, // matches hartwich-os's own cadence cap (src/lib/emails/cadence.ts)
  cta: { maxCtasPerMessage: 1, preferredCta: "a quick call" },
  wordCountRange: { min: 80, max: 160 },
};
