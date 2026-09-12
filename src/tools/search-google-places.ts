import { z } from "zod";
import type { ToolDefinition } from "../runtime/types.js";

const InputSchema = z.object({
  area: z.string().min(1), // e.g. "Winnipeg, MB"
  keyword: z.string().min(1), // e.g. "HVAC contractor" — HVAC-specific by design (Gavin, 2026-09-09), not a generic niche switcher
  maxResults: z.number().int().min(1).max(20).default(20),
});

export type PlaceCandidate = {
  placeId: string;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  userRatingCount: number | null;
};

const PLACES_BASE = "https://places.googleapis.com/v1";

/**
 * Read-only wrapper around the Places API (New) Text Search — same
 * endpoint and field mask hartwich-os's own
 * src/lib/integrations/google-places.ts uses, reimplemented here because
 * this is a separate repo/service (Gavin, 2026-09-09) with no code-level
 * access to hartwich-os's integration module, only to the same external
 * Google API. `fetchImpl` is injectable so tests never make a real HTTP
 * call.
 */
export function createSearchGooglePlacesTool(
  fetchImpl: typeof fetch = fetch
): ToolDefinition<z.infer<typeof InputSchema>, PlaceCandidate[]> {
  return {
    name: "search_google_places",
    description: "Text-search Google Places (New) for businesses matching a keyword in an area.",
    mutating: false,
    inputSchema: InputSchema,
    async execute(input) {
      const apiKey = process.env.GOOGLE_PLACES_API_KEY;
      if (!apiKey) {
        throw new Error("GOOGLE_PLACES_API_KEY is not set — required for search_google_places.");
      }

      const res = await fetchImpl(`${PLACES_BASE}/places:searchText`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask":
            "places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount",
        },
        body: JSON.stringify({
          textQuery: `${input.keyword} in ${input.area}`,
          maxResultCount: input.maxResults,
        }),
      });

      if (!res.ok) {
        throw new Error(`Google Places text search failed: ${res.status} ${await res.text()}`);
      }

      const data = (await res.json()) as {
        places?: Array<{
          id: string;
          displayName?: { text: string };
          formattedAddress?: string;
          nationalPhoneNumber?: string;
          websiteUri?: string;
          rating?: number;
          userRatingCount?: number;
        }>;
      };

      return (data.places ?? []).map((p) => ({
        placeId: p.id,
        name: p.displayName?.text ?? "(unnamed)",
        address: p.formattedAddress ?? null,
        phone: p.nationalPhoneNumber ?? null,
        website: p.websiteUri ?? null,
        rating: p.rating ?? null,
        userRatingCount: p.userRatingCount ?? null,
      }));
    },
  };
}
