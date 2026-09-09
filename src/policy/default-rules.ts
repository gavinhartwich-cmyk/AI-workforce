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
 * is explicitly autonomous per SPEC.md §17. It's the SEND that stays a
 * higher bar (Phase 5's job): creating a draft never reaches a prospect,
 * it only puts something in hartwich-os's existing pending_review queue
 * for a human (or, later, an autonomous approval routine) to act on.
 *
 * Later phases add rules here for outreach sending, pricing/offer changes,
 * etc. — see SPEC.md §18's `AuthorityPolicy` (maxVolume/maxBudget/
 * maxChangePercent) for the richer shape those will need; this is
 * intentionally just `minAutonomyLevel` until a phase actually needs more.
 */
export const DEFAULT_POLICY_RULES: PolicyRule[] = [
  { tool: "persist_discovered_company", minAutonomyLevel: AUTONOMY.AUTONOMOUS_ROUTINE },
  { tool: "create_email_draft", minAutonomyLevel: AUTONOMY.AUTONOMOUS_ROUTINE },
];
