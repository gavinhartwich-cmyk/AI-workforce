import type { PolicyRule } from "../runtime/policy-engine.js";
import { AUTONOMY } from "../runtime/autonomy-levels.js";

/**
 * Default policy rules (SPEC.md §18-19) — data, not code, loaded into
 * DefaultPolicyEngine at startup. Discovery/research/qualification/CRM
 * writes are on SPEC.md §17's "Autonomous" list, so committing a
 * discovered-and-qualified lead into hartwich-os's CRM is routine work at
 * AUTONOMOUS_ROUTINE (3) — no per-lead human approval.
 *
 * `create_email_draft` (Phase 4) is on the same list — "generate outreach"
 * is explicitly autonomous per SPEC.md §17.
 *
 * `send_email`/`record_outbound_email` (Phase 5) are ALSO
 * AUTONOMOUS_ROUTINE — per Gavin (2026-09-XX) and SPEC.md §2/§17/§20,
 * routine outbound is autonomous by default, not gated on a per-email
 * approval. "Properly handled" is enforced upstream, in the pipeline
 * (src/pipelines/execute-outreach.ts), not here: this generic policy
 * engine has no notion of a specific contact's opt-out status or a
 * specific Gmail account's warm-up state, so those checks — opt-out,
 * kill switch, duplicate-contact, sending window, rate limit — live where
 * that live state actually is, and run BEFORE send_email is ever called.
 * This rule only says an agent at this autonomy level is structurally
 * allowed to send at all; it is not the substantive safety check.
 *
 * Phase 6 adds reply-handling tools at the same level: routine
 * conversation handling is autonomous per SPEC.md §17/§29 (classify,
 * reply, suppress on request, close a clear no). `notify_gavin` is the one
 * exception worth calling out even though it's also AUTONOMOUS_ROUTINE —
 * autonomy here means the AGENT may decide escalation is warranted and
 * send the alert without asking first, not that the escalation itself is
 * silent; the alert email IS the human-in-the-loop step for PRICE/HOSTILE
 * replies (src/outreach/reply-routing.ts never lets those get an
 * autonomous reply).
 *
 * Later phases add rules here for pricing/offer changes, new channels,
 * etc. — see SPEC.md §18's `AuthorityPolicy` (maxVolume/maxBudget/
 * maxChangePercent) for the richer shape those will need; this is
 * intentionally just `minAutonomyLevel` until a phase actually needs more.
 */
export const DEFAULT_POLICY_RULES: PolicyRule[] = [
  { tool: "persist_discovered_company", minAutonomyLevel: AUTONOMY.AUTONOMOUS_ROUTINE },
  { tool: "create_email_draft", minAutonomyLevel: AUTONOMY.AUTONOMOUS_ROUTINE },
  { tool: "send_email", minAutonomyLevel: AUTONOMY.AUTONOMOUS_ROUTINE },
  { tool: "record_outbound_email", minAutonomyLevel: AUTONOMY.AUTONOMOUS_ROUTINE },
  { tool: "mark_email_read", minAutonomyLevel: AUTONOMY.AUTONOMOUS_ROUTINE },
  { tool: "record_inbound_reply", minAutonomyLevel: AUTONOMY.AUTONOMOUS_ROUTINE },
  { tool: "close_deal_lost", minAutonomyLevel: AUTONOMY.AUTONOMOUS_ROUTINE },
  { tool: "flag_deal_for_review", minAutonomyLevel: AUTONOMY.AUTONOMOUS_ROUTINE },
  { tool: "notify_gavin", minAutonomyLevel: AUTONOMY.AUTONOMOUS_ROUTINE },
];
