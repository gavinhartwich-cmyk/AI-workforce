import { AUTONOMY } from "../runtime/autonomy-levels.js";
import type { AuthorityPolicy } from "./types.js";

/**
 * SPEC.md §18: a formal authority model, data not code — tightening or
 * loosening what the manager may do on its own is a config change here,
 * not a redeploy, same philosophy as src/policy/default-rules.ts. Mirrors
 * §18's own worked example in spirit ("+20% autonomous, +300% requires
 * approval") without copying its numbers verbatim — these are Hartwich's
 * actual defaults, chosen deliberately small so a real ICP-widening
 * decision reliably escalates rather than sneaking through as "just a
 * bigger discovery run" (SPEC.md §17: "major ICP changes" needs a human).
 */
export const DEFAULT_AUTHORITY_POLICIES: AuthorityPolicy[] = [
  // Prospect Discovery is unconditionally autonomous (SPEC.md §17) up to a
  // volume increase this large. Anything bigger reads as the manager
  // thinking the ICP itself may need to widen, not just "run it again" —
  // that's a human-confirmation decision, not a volume knob.
  { capability: "discover_prospects", autonomyLevel: AUTONOMY.MANAGER_COORDINATION, maxChangePercent: 20 },
  // Creating a controlled experiment is unconditionally autonomous
  // (SPEC.md §17/§34) — no volume/budget cap. src/experiments/sample-size.ts
  // already refuses to draw conclusions from too small a sample, and
  // nothing here spends money or changes the approved offer/positioning —
  // only which pre-approved variant a given prospect sees.
  { capability: "create_controlled_experiment", autonomyLevel: AUTONOMY.MANAGER_COORDINATION },
];

export type AuthorityCheck = { allowed: true } | { allowed: false; reason: string };

/**
 * SPEC.md §19's fail-closed rule applied to the manager's own authority,
 * not just tool policy: a capability with no matching policy is denied,
 * never silently permitted.
 */
export function checkAuthority(
  capability: string,
  proposedChangePercent: number | undefined,
  agentAutonomyLevel: number,
  policies: AuthorityPolicy[] = DEFAULT_AUTHORITY_POLICIES
): AuthorityCheck {
  const policy = policies.find((p) => p.capability === capability);
  if (!policy) {
    return {
      allowed: false,
      reason: `No authority policy covers "${capability}" — denying by default (SPEC.md §19's fail-closed rule).`,
    };
  }
  if (policy.requiresApproval) {
    return { allowed: false, reason: `"${capability}" always requires approval per policy.` };
  }
  if (agentAutonomyLevel < policy.autonomyLevel) {
    return { allowed: false, reason: `"${capability}" requires autonomy level ${policy.autonomyLevel}.` };
  }
  if (
    policy.maxChangePercent != null &&
    proposedChangePercent != null &&
    proposedChangePercent > policy.maxChangePercent
  ) {
    return {
      allowed: false,
      reason: `Proposed change of ${proposedChangePercent}% exceeds the autonomous cap of ${policy.maxChangePercent}% for "${capability}".`,
    };
  }
  return { allowed: true };
}
