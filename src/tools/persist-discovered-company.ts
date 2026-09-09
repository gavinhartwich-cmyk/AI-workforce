import { z } from "zod";
import type { ToolDefinition } from "../runtime/types.js";
import { PostgresHartwichWriteStore, type HartwichWriteStore } from "../db/hartwich-os/write-store.js";

const InputSchema = z.object({
  place: z.object({
    name: z.string(),
    address: z.string().nullable(),
    phone: z.string().nullable(),
    website: z.string().nullable(),
    rating: z.number().nullable(),
    userRatingCount: z.number().nullable(),
  }),
  placeId: z.string(),
  status: z.enum(["qualified", "needs_review", "disqualified"]),
  qualificationScore: z.number().min(0).max(100),
  qualificationReasoning: z.string(),
  contactTier: z.enum(["A", "B", "C"]).nullable(),
  isOwnerOperated: z.boolean().nullable(),
  isFranchise: z.boolean(),
  disqualifyReason: z.string().nullable(),
  enrichment: z
    .object({
      summary: z.string().nullable(),
      servicesOffered: z.array(z.string()).nullable(),
      apparentSize: z.string().nullable(),
      contactName: z.string().nullable(),
      contactTitle: z.string().nullable(),
      contactEmail: z.string().nullable(),
      contactPhone: z.string().nullable(),
      contactLinkedinUrl: z.string().nullable(),
      fallbackEmail: z.string().nullable(),
    })
    .nullable(),
});

/**
 * The single mutating tool in the Phase 2 discovery pipeline — everything
 * else (search, dedupe check, website fetch) is read-only. This is
 * deliberately the ONE consequential write: rather than separate
 * upsert_company/upsert_contact/create_deal tools that could be called out
 * of order or partially, one tool call commits the whole "file this lead"
 * decision atomically (see PostgresHartwichWriteStore), matching how
 * hartwich-os's own createDiscoveredCompany works. Per SPEC.md §17, this is
 * routine, autonomous-by-default work — see src/policy/default-rules.ts
 * for the autonomy level it requires.
 */
export function createPersistDiscoveredCompanyTool(
  store: HartwichWriteStore = new PostgresHartwichWriteStore()
): ToolDefinition<z.infer<typeof InputSchema>, Awaited<ReturnType<HartwichWriteStore["persistDiscoveredCompany"]>>> {
  return {
    name: "persist_discovered_company",
    description:
      "Commit a discovered-and-qualified lead into hartwich-os's CRM: company row, contact (if found), and deal (if qualified).",
    mutating: true,
    inputSchema: InputSchema,
    async execute(input) {
      return store.persistDiscoveredCompany(input);
    },
  };
}
