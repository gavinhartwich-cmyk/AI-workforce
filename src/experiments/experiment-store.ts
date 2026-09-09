import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { experiments, experimentVariants } from "../db/schema.js";
import type { Experiment, ExperimentStatus, ExperimentVariant } from "./types.js";

export type CreateExperimentInput = {
  name: string;
  description: string;
  minSampleSizePerVariant: number;
  variants: Omit<ExperimentVariant, "id">[];
};

export interface ExperimentStore {
  create(input: CreateExperimentInput): Promise<Experiment>;
  get(id: string): Promise<Experiment | null>;
  listRunning(): Promise<Experiment[]>;
  updateStatus(id: string, status: ExperimentStatus): Promise<void>;
}

export class PostgresExperimentStore implements ExperimentStore {
  async create(input: CreateExperimentInput): Promise<Experiment> {
    const db = getDb();
    return db.transaction(async (tx) => {
      const [row] = await tx
        .insert(experiments)
        .values({
          name: input.name,
          description: input.description,
          minSampleSizePerVariant: input.minSampleSizePerVariant,
          status: "running",
        })
        .returning();

      const variantRows = await tx
        .insert(experimentVariants)
        .values(
          input.variants.map((v) => ({
            experimentId: row.id,
            name: v.name,
            directive: v.directive,
            weight: v.weight.toString(),
          }))
        )
        .returning();

      return toDomain(row, variantRows);
    });
  }

  async get(id: string): Promise<Experiment | null> {
    const db = getDb();
    const row = await db.query.experiments.findFirst({
      where: eq(experiments.id, id),
      with: { variants: true },
    });
    return row ? toDomain(row, row.variants) : null;
  }

  async listRunning(): Promise<Experiment[]> {
    const db = getDb();
    const rows = await db.query.experiments.findMany({
      where: eq(experiments.status, "running"),
      with: { variants: true },
    });
    return rows.map((row) => toDomain(row, row.variants));
  }

  async updateStatus(id: string, status: ExperimentStatus): Promise<void> {
    const db = getDb();
    await db.update(experiments).set({ status }).where(eq(experiments.id, id));
  }
}

function toDomain(
  row: typeof experiments.$inferSelect,
  variantRows: (typeof experimentVariants.$inferSelect)[]
): Experiment {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    minSampleSizePerVariant: row.minSampleSizePerVariant,
    status: row.status,
    createdAt: row.createdAt,
    variants: variantRows.map((v) => ({ id: v.id, name: v.name, directive: v.directive, weight: Number(v.weight) })),
  };
}
