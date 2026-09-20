import { z } from "zod";
import type { ToolDefinition } from "../runtime/types.js";

const InputSchema = z.object({ website: z.string().url() });

export type WebsiteFetchResult = {
  text: string | null; // stripped, truncated plain text — null if the fetch/parse failed
  fallbackEmail: string | null; // deterministic mailto:/regex scrape, independent of any LLM read
};

/**
 * How much scraped page text is handed to the model.
 *
 * Was 15,000 — roughly 3,750 tokens, which measurement showed was
 * essentially the entire per-candidate cost: prospect_assessment_agent came
 * in at 3,645 tokens per call on 2026-09-12, and 17 candidates in one cycle
 * burned 62k of a 160k daily budget. The page text IS the cost; the number
 * of agent calls never was. Merging research and qualification into one
 * call turned out roughly cost-neutral for exactly this reason.
 *
 * 4,000 chars is about a screenful of real copy, which is where the signals
 * this pipeline actually needs live — services offered, apparent size, a
 * named contact, how the business talks about reviews. The remaining 11k
 * was mostly navigation, footers and boilerplate, which `stripBoilerplate`
 * below now removes before the cap is even applied.
 *
 * Overridable so the ceiling can be tuned against real token-per-call
 * numbers (npm run tokens) without a redeploy.
 */
const DEFAULT_MAX_TEXT_CHARS = 4_000;

function maxTextChars(): number {
  const raw = Number(process.env.WEBSITE_TEXT_MAX_CHARS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_TEXT_CHARS;
}

// Same third-party-noise domain list as hartwich-os's own
// extractFallbackEmail (src/lib/ai/enrich-company.ts) — widget vendors,
// spec URLs, placeholder copy that show up incidentally in page source and
// are never a real contact for the business itself.
const IGNORED_EMAIL_DOMAINS = new Set([
  "example.com",
  "sentry.io",
  "wixpress.com",
  "godaddy.com",
  "schema.org",
  "w3.org",
  "gravatar.com",
  "cloudflare.com",
  "google.com",
  "googleapis.com",
  "yourdomain.com",
  "yoursite.com",
  "domain.com",
]);

/**
 * Drops the parts of a page that are never about this business in
 * particular — navigation, headers, footers, cookie banners, inline SVG —
 * before any truncation happens.
 *
 * Order matters: cutting boilerplate first means the character cap spends
 * itself on real copy rather than on a nav menu that happened to come first
 * in the document.
 */
function stripBoilerplate(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

function stripHtml(html: string): string {
  return stripBoilerplate(html)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractFallbackEmail(html: string, website: string): string | null {
  const found = new Set<string>();

  for (const m of html.matchAll(/mailto:([^"'?\s>]+)/gi)) {
    try {
      found.add(decodeURIComponent(m[1]).toLowerCase());
    } catch {
      found.add(m[1].toLowerCase());
    }
  }
  for (const m of html.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) {
    found.add(m[0].toLowerCase());
  }

  const candidates = [...found].filter((email) => {
    const domain = email.split("@")[1];
    if (!domain || IGNORED_EMAIL_DOMAINS.has(domain)) return false;
    if (/\.(png|jpg|jpeg|gif|svg|webp|css|js)$/i.test(email)) return false;
    return true;
  });
  if (candidates.length === 0) return null;

  let siteDomain: string | null = null;
  try {
    siteDomain = new URL(website).hostname.replace(/^www\./, "");
  } catch {
    siteDomain = null;
  }
  const onDomain = siteDomain ? candidates.find((e) => e.endsWith(`@${siteDomain}`)) : undefined;
  return onDomain ?? candidates[0];
}

/**
 * Read-only tool: fetches a company's website and returns plain text (for
 * the Research Agent's model call to read) plus a deterministic fallback
 * email scraped straight from the HTML — the same two-part approach as
 * hartwich-os's enrichCompanyFromWebsite (LLM extraction augmented by a
 * regex backstop that never depends on the model actually finding
 * anything). `fetchImpl` is injectable for tests.
 */
export function createFetchWebsiteTextTool(
  fetchImpl: typeof fetch = fetch
): ToolDefinition<z.infer<typeof InputSchema>, WebsiteFetchResult> {
  return {
    name: "fetch_website_text",
    description: "Fetch a company website and return its plain text plus any scraped contact email.",
    mutating: false,
    inputSchema: InputSchema,
    async execute(input) {
      let html: string;
      try {
        const res = await fetchImpl(input.website, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) return { text: null, fallbackEmail: null };
        html = await res.text();
      } catch {
        return { text: null, fallbackEmail: null };
      }

      const fallbackEmail = extractFallbackEmail(html, input.website);
      const text = stripHtml(html).slice(0, maxTextChars());
      return { text: text || null, fallbackEmail };
    },
  };
}
