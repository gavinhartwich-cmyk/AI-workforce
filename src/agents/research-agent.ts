import { z } from "zod";
import type { AgentDefinition } from "../runtime/types.js";
import { AUTONOMY } from "../runtime/autonomy-levels.js";

/**
 * Research Agent (SPEC.md §24). Turns a raw candidate + its website text
 * into structured business/contact/sales-signal intelligence. Every sales
 * signal must cite real evidence from what it was actually given — never
 * fabricated (SPEC.md §22, §24: "every important claim should have
 * evidence").
 */

const InputSchema = z.object({
  place: z.object({
    name: z.string(),
    address: z.string().nullable(),
    phone: z.string().nullable(),
    website: z.string().nullable(),
    rating: z.number().nullable(),
    userRatingCount: z.number().nullable(),
  }),
  /** Stripped website text, or null if there's no website / the fetch failed. */
  websiteText: z.string().nullable(),
});

const SalesSignalSchema = z.object({
  signal: z.string(),
  /** What in the given data actually supports this — a review-count fact, a specific line from the site, etc. */
  evidence: z.string(),
});

const OutputSchema = z.object({
  servicesOffered: z.array(z.string()),
  apparentSize: z.enum(["solo", "small", "medium", "large", "unknown"]),
  contactName: z.string().nullable(),
  contactTitle: z.string().nullable(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  contactLinkedinUrl: z.string().nullable(),
  summary: z.string(),
  salesSignals: z.array(SalesSignalSchema),
});

export type ResearchInput = z.infer<typeof InputSchema>;
export type ResearchOutput = z.infer<typeof OutputSchema>;

const JSON_SCHEMA = {
  type: "object",
  properties: {
    servicesOffered: { type: "array", items: { type: "string" } },
    apparentSize: { type: "string", enum: ["solo", "small", "medium", "large", "unknown"] },
    contactName: { type: ["string", "null"] },
    contactTitle: { type: ["string", "null"] },
    contactEmail: { type: ["string", "null"] },
    contactPhone: { type: ["string", "null"] },
    contactLinkedinUrl: { type: ["string", "null"] },
    summary: { type: "string" },
    salesSignals: {
      type: "array",
      items: {
        type: "object",
        properties: { signal: { type: "string" }, evidence: { type: "string" } },
        required: ["signal", "evidence"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "servicesOffered",
    "apparentSize",
    "contactName",
    "contactTitle",
    "contactEmail",
    "contactPhone",
    "contactLinkedinUrl",
    "summary",
    "salesSignals",
  ],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You research an HVAC business found via Google Places, for Hartwich Labs (Google review automation / reputation-management for HVAC service businesses). You are given the business's Google Places data and, if available, plain text scraped from its website — nothing else. Extract services offered, apparent size, and the primary decision-maker (owner, manager) if named. Only report what is actually stated or clearly implied in what you were given — use null for any contact field not found, and "unknown" for apparentSize if you can't tell. Never guess or invent a name, email, or fact.

For salesSignals, identify real evidence of a reputation-management opportunity for Hartwich Labs specifically — e.g. a low review count, a sub-4-star rating, or something the website itself says that suggests the business cares about growth/reviews/customer acquisition. Every signal must name the actual evidence for it (a number, a quoted or paraphrased line from the site) — an empty list is correct if nothing in the given data supports a signal; never fabricate one to fill the list.`;

export const researchAgent: AgentDefinition<ResearchInput, ResearchOutput> = {
  id: "research_agent",
  name: "Research Agent",
  version: "0.1.0",
  capabilities: ["prospect_research"],
  tools: [],
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  autonomyLevel: AUTONOMY.AUTONOMOUS_ROUTINE,
  modelLane: "fast",
  // The provider default (1024) was getting hit on real, larger websites —
  // confirmed live via the AI Workforce dashboard's run history: Groq
  // returned 400 json_validate_failed / "max completion tokens reached
  // before generating a valid document" for a real candidate whose scraped
  // page text ran long. This schema (a summary plus an evidenced signals
  // array plus several contact fields) is naturally one of the larger
  // outputs in this repo; give it real headroom instead of truncating.
  maxOutputTokens: 2048,
  buildPrompt(input) {
    return {
      system: SYSTEM_PROMPT,
      user: `Google Places data:\n${JSON.stringify(input.place, null, 2)}\n\nWebsite text:\n${
        input.websiteText ?? "(no website, or the fetch failed — work from the Places data alone)"
      }`,
      jsonSchema: JSON_SCHEMA,
    };
  },
};
