import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { managerEscalations } from "../db/schema.js";

export type EscalationStatus = "pending" | "approved" | "rejected" | "executed" | "failed";

export type ManagerEscalation = {
  id: string;
  goalId: string;
  capability: string;
  proposedChangePercent: number | null;
  action: string;
  diagnosis: string;
  whyApprovalRequired: string;
  /** The goal's forecast status when this was raised — the baseline for "has it got worse since?". */
  forecastStatus: string | null;
  expectedImpact: number | null;
  risk: number | null;
  status: EscalationStatus;
  executionNote: string | null;
  createdAt: Date;
  decidedAt: Date | null;
  executedAt: Date | null;
};

export type NewManagerEscalation = Omit<
  ManagerEscalation,
  "id" | "status" | "executionNote" | "createdAt" | "decidedAt" | "executedAt"
>;

/**
 * How long a *settled* escalation keeps suppressing a re-raise of the same
 * goal+capability.
 *
 * Suppressing only while "pending" wasn't enough: the moment Gavin approved
 * one it stopped being pending, so the very next cycle saw no open ask,
 * re-raised the identical decision and emailed him again — approving
 * actively generated more noise (2026-09-10). The bottleneck that triggers
 * these takes time to move, so a settled decision has to keep the question
 * closed for a while.
 */
export const EXECUTED_COOLDOWN_MS = 24 * 60 * 60 * 1000; // give the action a day to show an effect
export const FAILED_COOLDOWN_MS = 6 * 60 * 60 * 1000; // don't hammer him while it's broken

/**
 * A rejection means "not under these conditions", not "never again" — hence
 * 48h rather than the week this was first written as. A long timer trades
 * one failure mode for its opposite: the reason to reject a
 * discovery-volume increase today is usually that outreach is throttled
 * (Groq quota, warm-up caps), and those get fixed in days — at which point
 * the same recommendation may be right and a week-long mute would keep the
 * manager silent about it.
 *
 * A timer is only a proxy for what actually matters, which is whether the
 * situation changed — see `blocksReRaise`, which lets a genuinely worse
 * forecast through early regardless of this.
 */
export const REJECTED_COOLDOWN_MS = 48 * 60 * 60 * 1000;

/**
 * Severity order for GoalStatus, worst last. Only used to decide whether
 * things have got materially worse since an escalation was settled.
 */
const STATUS_SEVERITY: Record<string, number> = {
  ACHIEVED: 0,
  ON_TRACK: 1,
  NOT_STARTED: 2,
  AT_RISK: 3,
  BEHIND: 4,
  CRITICAL: 5,
  FAILED: 6,
};

function isWorse(current: string | null, previous: string | null): boolean {
  if (!current || !previous) return false;
  const now = STATUS_SEVERITY[current];
  const before = STATUS_SEVERITY[previous];
  return now !== undefined && before !== undefined && now > before;
}

export interface EscalationStore {
  /**
   * An existing escalation that should stop this goal+capability being
   * raised again right now — either still open (pending/approved), or
   * settled recently enough to be within its cooldown. Pass the goal's
   * current forecast status so a genuinely worse situation can cut the
   * cooldown short.
   */
  findBlocking(
    goalId: string,
    capability: string,
    now?: Date,
    currentForecastStatus?: string | null
  ): Promise<ManagerEscalation | null>;
  /** Everything Gavin has approved but the manager hasn't carried out yet. */
  listApproved(): Promise<ManagerEscalation[]>;
  raise(escalation: NewManagerEscalation): Promise<ManagerEscalation>;
  markExecuted(id: string, note: string | null, at: Date): Promise<void>;
  markFailed(id: string, note: string, at: Date): Promise<void>;
}

function toDomain(row: typeof managerEscalations.$inferSelect): ManagerEscalation {
  return {
    id: row.id,
    goalId: row.goalId,
    capability: row.capability,
    proposedChangePercent: row.proposedChangePercent,
    action: row.action,
    diagnosis: row.diagnosis,
    whyApprovalRequired: row.whyApprovalRequired,
    forecastStatus: row.forecastStatus,
    // numeric comes back as a string from postgres.js — coerce here rather
    // than letting a string masquerade as a number downstream.
    expectedImpact: row.expectedImpact === null ? null : Number(row.expectedImpact),
    risk: row.risk === null ? null : Number(row.risk),
    status: row.status,
    executionNote: row.executionNote,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
    executedAt: row.executedAt,
  };
}

/**
 * Whether an existing escalation still blocks re-raising the same question.
 *
 * `currentForecastStatus` is the escape hatch: if the goal has actually got
 * worse since this was settled, that's a different situation from the one
 * Gavin answered, so the cooldown is skipped and he gets asked again. Without
 * it a rejection would mute a question even as the goal fell off a cliff.
 */
export function blocksReRaise(
  escalation: ManagerEscalation,
  now: Date,
  currentForecastStatus?: string | null
): boolean {
  // Still open — the ask is live either way, however bad things get.
  if (escalation.status === "pending" || escalation.status === "approved") return true;

  // Materially worse than when it was settled — worth asking again now.
  if (isWorse(currentForecastStatus ?? null, escalation.forecastStatus)) return false;

  const cooldown =
    escalation.status === "rejected"
      ? REJECTED_COOLDOWN_MS
      : escalation.status === "failed"
        ? FAILED_COOLDOWN_MS
        : EXECUTED_COOLDOWN_MS;
  const settledAt = escalation.executedAt ?? escalation.decidedAt ?? escalation.createdAt;
  return now.getTime() - settledAt.getTime() < cooldown;
}

export class PostgresEscalationStore implements EscalationStore {
  async findBlocking(
    goalId: string,
    capability: string,
    now: Date = new Date(),
    currentForecastStatus?: string | null
  ): Promise<ManagerEscalation | null> {
    const db = getDb();
    // Newest first: only the most recent settlement matters for the cooldown.
    const rows = await db.query.managerEscalations.findMany({
      where: and(eq(managerEscalations.goalId, goalId), eq(managerEscalations.capability, capability)),
      orderBy: desc(managerEscalations.createdAt),
      limit: 5,
    });
    const blocking = rows.map(toDomain).find((e) => blocksReRaise(e, now, currentForecastStatus));
    return blocking ?? null;
  }

  async listApproved(): Promise<ManagerEscalation[]> {
    const db = getDb();
    const rows = await db.query.managerEscalations.findMany({
      where: eq(managerEscalations.status, "approved"),
      orderBy: desc(managerEscalations.createdAt),
    });
    return rows.map(toDomain);
  }

  async raise(escalation: NewManagerEscalation): Promise<ManagerEscalation> {
    const db = getDb();
    const [row] = await db
      .insert(managerEscalations)
      .values({
        goalId: escalation.goalId,
        capability: escalation.capability,
        proposedChangePercent: escalation.proposedChangePercent,
        action: escalation.action,
        diagnosis: escalation.diagnosis,
        whyApprovalRequired: escalation.whyApprovalRequired,
        forecastStatus: escalation.forecastStatus,
        expectedImpact: escalation.expectedImpact === null ? null : String(escalation.expectedImpact),
        risk: escalation.risk === null ? null : String(escalation.risk),
      })
      .returning();
    return toDomain(row);
  }

  async markExecuted(id: string, note: string | null, at: Date): Promise<void> {
    const db = getDb();
    await db
      .update(managerEscalations)
      .set({ status: "executed", executionNote: note, executedAt: at })
      .where(eq(managerEscalations.id, id));
  }

  async markFailed(id: string, note: string, at: Date): Promise<void> {
    const db = getDb();
    await db
      .update(managerEscalations)
      .set({ status: "failed", executionNote: note, executedAt: at })
      .where(eq(managerEscalations.id, id));
  }
}
