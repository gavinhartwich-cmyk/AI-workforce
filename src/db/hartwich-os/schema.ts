/**
 * NOT a source of truth. This is a narrow, explicitly-a-mirror subset of
 * hartwich-os's real schema (hartwich-os/src/db/schema.ts), just the
 * columns Phase 1's example tool (src/tools/get-company.ts) reads.
 *
 * hartwich-os owns this table — its migrations create/alter it, not this
 * repo's. If hartwich-os's `companies` table changes shape, this file needs
 * a matching update; it is never used to generate or push a migration
 * against hartwich-os's database (see drizzle.config.ts — that config only
 * points at this repo's own database).
 *
 * Kept read-only on purpose for Phase 1: no agent yet has a reason to
 * write into hartwich-os's CRM tables, and the spec is explicit that no
 * autonomous outbound messaging happens in this phase.
 */

import { integer, numeric, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const companySourceEnum = pgEnum("company_source", ["google_places", "apollo", "manual"]);
export const companyStatusEnum = pgEnum("company_status", ["needs_review", "qualified", "disqualified"]);

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  website: text("website"),
  phone: text("phone"),
  city: text("city"),
  state: text("state"),
  source: companySourceEnum("source").notNull(),
  googleReviewCount: integer("google_review_count"),
  googleRating: numeric("google_rating", { precision: 3, scale: 2 }),
  qualificationScore: integer("qualification_score"),
  qualificationReasoning: text("qualification_reasoning"),
  status: companyStatusEnum("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});
