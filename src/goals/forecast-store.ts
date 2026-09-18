import { getDb } from "../db/client.js";
import { salesForecasts } from "../db/schema.js";
import type { ForecastResult, PaceResult } from "./types.js";

export interface ForecastStore {
  record(goalId: string, pace: PaceResult, forecast: ForecastResult, currentValue: number, asOf: Date): Promise<void>;
}

export class PostgresForecastStore implements ForecastStore {
  async record(
    goalId: string,
    pace: PaceResult,
    forecast: ForecastResult,
    currentValue: number,
    asOf: Date
  ): Promise<void> {
    const db = getDb();
    await db.insert(salesForecasts).values({
      goalId,
      asOf,
      currentValue: currentValue.toString(),
      expectedByNow: pace.expectedByNow.toString(),
      currentPace: pace.currentPace.toString(),
      requiredFuturePace: pace.requiredFuturePace.toString(),
      projectedFinal: forecast.projectedFinal.toString(),
      probability: Math.round(forecast.probability),
      status: forecast.status,
    });
  }
}
