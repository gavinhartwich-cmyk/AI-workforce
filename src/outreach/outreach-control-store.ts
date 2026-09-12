import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { outreachControl } from "../db/schema.js";

export type OutreachControlState = { sendingPaused: boolean; pausedReason: string | null };

export interface OutreachControlStore {
  getState(): Promise<OutreachControlState>;
  pause(reason: string): Promise<void>;
  resume(): Promise<void>;
}

const ROW_ID = "default";

/** The kill switch (SPEC.md §57) — a single row, read before every autonomous send. */
export class PostgresOutreachControlStore implements OutreachControlStore {
  async getState(): Promise<OutreachControlState> {
    const db = getDb();
    const row = await db.query.outreachControl.findFirst({ where: eq(outreachControl.id, ROW_ID) });
    return row ? { sendingPaused: row.sendingPaused, pausedReason: row.pausedReason } : { sendingPaused: false, pausedReason: null };
  }

  async pause(reason: string): Promise<void> {
    const db = getDb();
    await db
      .insert(outreachControl)
      .values({ id: ROW_ID, sendingPaused: true, pausedReason: reason, updatedAt: new Date() })
      .onConflictDoUpdate({ target: outreachControl.id, set: { sendingPaused: true, pausedReason: reason, updatedAt: new Date() } });
  }

  async resume(): Promise<void> {
    const db = getDb();
    await db
      .insert(outreachControl)
      .values({ id: ROW_ID, sendingPaused: false, pausedReason: null, updatedAt: new Date() })
      .onConflictDoUpdate({ target: outreachControl.id, set: { sendingPaused: false, pausedReason: null, updatedAt: new Date() } });
  }
}
