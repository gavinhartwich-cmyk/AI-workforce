/**
 * Named autonomy levels (original V1 spec §31, still the ladder SPEC.md's
 * capability-based permissions build on — SPEC.md §17-18). Used as
 * `AgentDefinition.autonomyLevel` and in policy rules, so both sides read
 * "AUTONOMOUS_ROUTINE" instead of a bare 3.
 */
export const AUTONOMY = {
  OBSERVE_ONLY: 0,
  RECOMMEND: 1,
  PREPARE_AND_REQUEST_APPROVAL: 2,
  AUTONOMOUS_ROUTINE: 3,
  MANAGER_COORDINATION: 4,
  STRATEGIC: 5,
} as const;
