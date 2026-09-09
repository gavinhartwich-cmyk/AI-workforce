import { z } from "zod";
import type { ToolDefinition } from "../runtime/types.js";
import { getHartwichOsDb } from "../db/hartwich-os/client.js";
import { normalizeCompanyName, websiteDomain } from "./dedupe-utils.js";

const InputSchema = z.object({ name: z.string(), website: z.string().nullable() });

export type DuplicateCheckResult = { duplicate: boolean; existingCompanyId: string | null };

/**
 * Read-only dedupe check against hartwich-os's `companies` table — same
 * rule as hartwich-os's own findDuplicateCompany (normalized name, or
 * website domain, match). Injectable `listExisting` for tests, same
 * pattern as get-company.ts.
 */
export function createFindDuplicateCompanyTool(
  listExisting: () => Promise<{ id: string; name: string; website: string | null }[]> = defaultListExisting
): ToolDefinition<z.infer<typeof InputSchema>, DuplicateCheckResult> {
  return {
    name: "find_duplicate_company",
    description: "Check whether a candidate company already exists in hartwich-os's CRM.",
    mutating: false,
    inputSchema: InputSchema,
    async execute(input) {
      const existing = await listExisting();
      const targetDomain = websiteDomain(input.website);
      const normalizedTarget = normalizeCompanyName(input.name);

      const match = existing.find((c) => {
        if (targetDomain && websiteDomain(c.website) === targetDomain) return true;
        return normalizeCompanyName(c.name) === normalizedTarget;
      });

      return { duplicate: !!match, existingCompanyId: match?.id ?? null };
    },
  };
}

async function defaultListExisting() {
  const db = getHartwichOsDb();
  return db.query.companies.findMany({
    columns: { id: true, name: true, website: true },
  });
}
