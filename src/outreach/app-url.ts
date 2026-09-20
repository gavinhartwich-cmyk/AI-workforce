/** Same HARTWICH_APP_URL as booking-link.ts — a direct link to the company record in hartwich-os, for task descriptions and escalation alerts. */
export function buildCompanyUrl(companyId: string): string {
  const appUrl = process.env.HARTWICH_APP_URL;
  if (!appUrl) throw new Error("HARTWICH_APP_URL is not set — required to build a company link.");
  return `${appUrl.replace(/\/$/, "")}/companies/${companyId}`;
}
