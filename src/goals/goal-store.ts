import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { salesGoals } from "../db/schema.js";
import type { GoalConstraints, GoalMetric, GoalPriority, GoalStatus, SalesGoal } from "./types.js";

export type CreateGoalInput = {
  metric: GoalMetric;
  target: number;
  periodStart: Date;
  periodEnd: Date;
  priority?: GoalPriority;
  constraints?: GoalConstraints;
};

/** CRUD for sales_goals — injectable so tests never need a live database. */
export interface GoalStore {
  create(input: CreateGoalInput): Promise<SalesGoal>;
  get(id: string): Promise<SalesGoal | null>;
  listActive(): Promise<SalesGoal[]>;
  updateStatus(id: string, status: GoalStatus): Promise<void>;
}

function toDomain(row: typeof salesGoals.$inferSelect): SalesGoal {
  return {
    id: row.id,
    metric: row.metric as GoalMetric,
    target: Number(row.target),
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    priority: row.priority,
    constraints: row.constraints ?? null,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PostgresGoalStore implements GoalStore {
  async create(input: CreateGoalInput): Promise<SalesGoal> {
    const db = getDb();
    const [row] = await db
      .insert(salesGoals)
      .values({
        metric: input.metric,
        target: input.target.toString(),
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        priority: input.priority ?? "normal",
        constraints: input.constraints ?? null,
        status: "NOT_STARTED",
      })
      .returning();
    return toDomain(row);
  }

  async get(id: string): Promise<SalesGoal | null> {
    const db = getDb();
    const row = await db.query.salesGoals.findFirst({ where: eq(salesGoals.id, id) });
    return row ? toDomain(row) : null;
  }

  async listActive(): Promise<SalesGoal[]> {
    const db = getDb();
    const rows = await db.query.salesGoals.findMany({
      where: (g, { notInArray }) => notInArray(g.status, ["ACHIEVED", "FAILED"]),
    });
    return rows.map(toDomain);
  }

  async updateStatus(id: string, status: GoalStatus): Promise<void> {
    const db = getDb();
    await db.update(salesGoals).set({ status, updatedAt: new Date() }).where(eq(salesGoals.id, id));
  }
}
