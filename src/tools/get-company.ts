import { z } from "zod";
import type { ToolDefinition } from "../runtime/types.js";
import { getHartwichOsDb } from "../db/hartwich-os/client.js";

const InputSchema = z.object({ companyId: z.string().uuid() });

export type CompanyRecord = {
  id: string;
  name: string;
  website: string | null;
  city: string | null;
  state: string | null;
  googleReviewCount: number | null;
  googleRating: string | null;
  qualificationScore: number | null;
  qualificationReasoning: string | null;
  status: string;
} | null;

/**
 * Read-only lookup against hartwich-os's `companies` table (spec §1: agents
 * operate through a tool layer on top of hartwich-os, never a second CRM).
 * `lookup` is injectable so tests can exercise the full runtime pipeline —
 * including a real tool call and policy check — without a live database
 * connection; the default wires up the real Postgres read.
 */
export function createGetCompanyTool(
  lookup: (companyId: string) => Promise<CompanyRecord> = defaultLookup
): ToolDefinition<z.infer<typeof InputSchema>, CompanyRecord> {
  return {
    name: "get_company",
    description: "Look up a company by id in hartwich-os's CRM.",
    mutating: false,
    inputSchema: InputSchema,
    async execute(input) {
      return lookup(input.companyId);
    },
  };
}

async function defaultLookup(companyId: string): Promise<CompanyRecord> {
  const db = getHartwichOsDb();
  const row = await db.query.companies.findFirst({
    where: (c, { eq }) => eq(c.id, companyId),
  });
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    website: row.website,
    city: row.city,
    state: row.state,
    googleReviewCount: row.googleReviewCount,
    googleRating: row.googleRating,
    qualificationScore: row.qualificationScore,
    qualificationReasoning: row.qualificationReasoning,
    status: row.status,
  };
}
