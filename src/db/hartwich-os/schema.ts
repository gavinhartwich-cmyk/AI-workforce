/**
 * NOT a source of truth. This is a narrow, explicitly-a-mirror subset of
 * hartwich-os's real schema (hartwich-os/src/db/schema.ts) — just the
 * tables/columns Phase 1-2's tools read or write
 * (src/tools/get-company.ts, find-duplicate-company.ts,
 * persist-discovered-company.ts).
 *
 * hartwich-os owns these tables — its migrations create/alter them, not
 * this repo's. If hartwich-os's schema changes shape, this file needs a
 * matching update; it is never used to generate or push a migration
 * against hartwich-os's database (see drizzle.config.ts — that config only
 * points at this repo's own database).
 */

import { boolean, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const companySourceEnum = pgEnum("company_source", ["google_places", "apollo", "manual"]);
export const companyStatusEnum = pgEnum("company_status", ["needs_review", "qualified", "disqualified"]);
export const contactTierEnum = pgEnum("contact_tier", ["A", "B", "C"]);
export const emailDraftStatusEnum = pgEnum("email_draft_status", ["pending_review", "approved", "rejected", "sent"]);
export const emailDraftKindEnum = pgEnum("email_draft_kind", [
  "cold_outreach",
  "follow_up",
  "bounce_correction",
  "reply",
]);

export const pipelineStages = pgTable("pipeline_stages", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  position: integer("position").notNull(),
  isWon: boolean("is_won").notNull(),
  isLost: boolean("is_lost").notNull(),
});

export const companies = pgTable("companies", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  website: text("website"),
  phone: text("phone"),
  addressLine: text("address_line"),
  city: text("city"),
  state: text("state"),
  postalCode: text("postal_code"),
  source: companySourceEnum("source").notNull(),
  sourceRefId: text("source_ref_id"),
  googleReviewCount: integer("google_review_count"),
  googleRating: numeric("google_rating", { precision: 3, scale: 2 }),
  isOwnerOperated: boolean("is_owner_operated"),
  isFranchise: boolean("is_franchise"),
  contactTier: contactTierEnum("contact_tier"),
  qualificationScore: integer("qualification_score"),
  qualificationReasoning: text("qualification_reasoning"),
  websiteSummary: text("website_summary"),
  servicesOffered: jsonb("services_offered").$type<string[]>(),
  apparentSize: text("apparent_size"),
  disqualifyReason: text("disqualify_reason"),
  status: companyStatusEnum("status").notNull().default("needs_review"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const contacts = pgTable("contacts", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull(),
  name: text("name"),
  title: text("title"),
  email: text("email"),
  phone: text("phone"),
  linkedinUrl: text("linkedin_url"),
  isPrimary: boolean("is_primary").notNull().default(false),
  source: companySourceEnum("source").notNull().default("manual"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const deals = pgTable("deals", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull(),
  stageId: uuid("stage_id").notNull(),
  valueEstimate: numeric("value_estimate", { precision: 12, scale: 2 }),
  priority: integer("priority").notNull().default(0),
  stageEnteredAt: timestamp("stage_entered_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// email_drafts — hartwich-os's existing human-approval queue (its own
// PHASE_3.md). Phase 4 writes into this SAME table (kind: "cold_outreach",
// status: "pending_review") rather than inventing a parallel drafts
// system — Gavin already has a UI for this in hartwich-os today. Only the
// columns this repo's create_email_draft tool sets are mirrored;
// approvedBy/rejectedBy/sentAt/etc. are hartwich-os's own send-flow
// concerns, not something this repo reads or writes.
export const emailDrafts = pgTable("email_drafts", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull(),
  contactId: uuid("contact_id").notNull(),
  dealId: uuid("deal_id"),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  status: emailDraftStatusEnum("status").notNull().default("pending_review"),
  kind: emailDraftKindEnum("kind").notNull().default("cold_outreach"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const companiesRelations = relations(companies, ({ many }) => ({
  contacts: many(contacts),
  deals: many(deals),
}));

export const contactsRelations = relations(contacts, ({ one }) => ({
  company: one(companies, { fields: [contacts.companyId], references: [companies.id] }),
}));

export const dealsRelations = relations(deals, ({ one }) => ({
  company: one(companies, { fields: [deals.companyId], references: [companies.id] }),
  stage: one(pipelineStages, { fields: [deals.stageId], references: [pipelineStages.id] }),
}));
