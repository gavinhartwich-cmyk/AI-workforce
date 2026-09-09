import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { suppressedContacts } from "../db/schema.js";

export interface OptOutStore {
  isSuppressed(email: string): Promise<boolean>;
  suppress(email: string, reason: string): Promise<void>;
}

export class PostgresOptOutStore implements OptOutStore {
  async isSuppressed(email: string): Promise<boolean> {
    const db = getDb();
    const row = await db.query.suppressedContacts.findFirst({
      where: eq(suppressedContacts.email, email.toLowerCase()),
    });
    return !!row;
  }

  async suppress(email: string, reason: string): Promise<void> {
    const db = getDb();
    await db
      .insert(suppressedContacts)
      .values({ email: email.toLowerCase(), reason })
      .onConflictDoUpdate({ target: suppressedContacts.email, set: { reason } });
  }
}
