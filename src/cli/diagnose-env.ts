/**
 * One-off diagnostic — never prints a raw secret value, only shape/length
 * and whether URL-shaped vars actually parse. Written to root-cause the
 * cron's "Invalid URL" / API-key-rejected failures without exposing
 * credentials in CI logs. Delete once the underlying issue is found.
 */
import "dotenv/config";

const VARS = [
  "AGENT_DATABASE_URL",
  "HARTWICH_DATABASE_URL",
  "GOOGLE_PLACES_API_KEY",
  "GROQ_API_KEY",
  "GMAIL_CLIENT_ID",
  "GMAIL_CLIENT_SECRET",
  "GMAIL_ACCESS_TOKEN_1",
  "GMAIL_REFRESH_TOKEN_1",
  "GMAIL_FROM_ADDRESS_1",
  "HARTWICH_APP_URL",
  "GAVIN_EMAIL",
];

const URL_SHAPED = new Set(["AGENT_DATABASE_URL", "HARTWICH_DATABASE_URL", "HARTWICH_APP_URL"]);

for (const key of VARS) {
  const raw = process.env[key];
  if (raw === undefined) {
    console.log(`${key}: UNSET`);
    continue;
  }
  const trimmed = raw.trim();
  const hasLeadingOrTrailingWhitespace = trimmed.length !== raw.length;
  const parts: string[] = [`len=${raw.length}`];
  if (hasLeadingOrTrailingWhitespace) parts.push(`TRIMMED_LEN=${trimmed.length} (has whitespace!)`);
  parts.push(`first3=${JSON.stringify(raw.slice(0, 3))}`, `last3=${JSON.stringify(raw.slice(-3))}`);
  if (URL_SHAPED.has(key)) {
    try {
      const u = new URL(raw);
      parts.push(`URL_PARSE=ok host=${u.hostname} port=${u.port} protocol=${u.protocol}`);
    } catch (err) {
      parts.push(`URL_PARSE=FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`${key}: ${parts.join(" | ")}`);
}
