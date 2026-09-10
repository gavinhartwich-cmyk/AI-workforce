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

export interface EscalationStore {
  /** The still-open escalation for this goal+capability, if one is already waiting. */
  findPending(goalId: string, capability: string): Promise<ManagerEscalation | null>;
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

export class PostgresEscalationStore implements EscalationStore {
  async findPending(goalId: string, capability: string): Promise<ManagerEscalation | null> {
    const db = getDb();
    const row = await db.query.managerEscalations.findFirst({
      where: and(
        eq(managerEscalations.goalId, goalId),
        eq(managerEscalations.capability, capability),
        eq(managerEscalations.status, "pending")
      ),
      orderBy: desc(managerEscalations.createdAt),
    });
    return row ? toDomain(row) : null;
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
