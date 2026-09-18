import { getDb } from "../db/client.js";
import { salesKpiSnapshots } from "../db/schema.js";
import type { GoalMetric, KpiValue } from "./types.js";

export interface KpiSnapshotStore {
  record(goalId: string, metric: GoalMetric, kpi: KpiValue, asOf: Date): Promise<void>;
}

export class PostgresKpiSnapshotStore implements KpiSnapshotStore {
  async record(goalId: string, metric: GoalMetric, kpi: KpiValue, asOf: Date): Promise<void> {
    const db = getDb();
    await db.insert(salesKpiSnapshots).values({
      goalId,
      metric,
      value: kpi.value != null ? kpi.value.toString() : null,
      confidence: kpi.confidence.toString(),
      dataSource: kpi.dataSource,
      note: kpi.note ?? null,
      asOf,
    });
  }
}
