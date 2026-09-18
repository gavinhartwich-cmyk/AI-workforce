import { getDb } from "../db/client.js";
import { managerDecisions } from "../db/schema.js";
import type { ManagerDecision } from "./types.js";

export interface ManagerDecisionStore {
  record(decision: ManagerDecision): Promise<string>; // returns the new row's id
  list(goalId: string): Promise<ManagerDecision[]>;
}

function toDomain(row: typeof managerDecisions.$inferSelect): ManagerDecision {
  return {
    id: row.id,
    goalId: row.goalId,
    observation: row.observation,
    diagnosis: row.diagnosis,
    options: row.options,
    selectedAction: row.selectedAction,
    reason: row.reason,
    expectedOutcome: row.expectedOutcome,
    actualOutcome: row.actualOutcome,
    createdAt: row.createdAt,
  };
}

export class PostgresManagerDecisionStore implements ManagerDecisionStore {
  async record(decision: ManagerDecision): Promise<string> {
    const db = getDb();
    const [row] = await db
      .insert(managerDecisions)
      .values({
        goalId: decision.goalId,
        observation: decision.observation,
        diagnosis: decision.diagnosis,
        options: decision.options,
        selectedAction: decision.selectedAction,
        reason: decision.reason,
        expectedOutcome: decision.expectedOutcome,
        actualOutcome: decision.actualOutcome ?? null,
      })
      .returning();
    return row.id;
  }

  async list(goalId: string): Promise<ManagerDecision[]> {
    const db = getDb();
    const rows = await db.query.managerDecisions.findMany({
      where: (d, { eq }) => eq(d.goalId, goalId),
      orderBy: (d, { desc }) => desc(d.createdAt),
    });
    return rows.map(toDomain);
  }
}
