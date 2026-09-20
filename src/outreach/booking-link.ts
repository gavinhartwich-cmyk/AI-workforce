/**
 * The Appointment Agent's entire "never invent availability" guarantee
 * (SPEC.md §31) comes from not implementing booking logic at all: hand the
 * prospect hartwich-os's own real, working, Google-Calendar-backed public
 * booking page (its PHASE_6.md), which already refuses to guess at open
 * slots. This repo only builds the link; hartwich-os's existing /book flow
 * does everything else — computing real availability, creating the
 * calendar event, notifying Gavin, recording the booking.
 */
export function buildBookingLink(params: { companyId: string; contactId: string | null; dealId: string | null }): string {
  const appUrl = process.env.HARTWICH_APP_URL;
  if (!appUrl) throw new Error("HARTWICH_APP_URL is not set — required to build a booking link.");

  const query = new URLSearchParams({ company: params.companyId });
  if (params.contactId) query.set("contact", params.contactId);
  if (params.dealId) query.set("deal", params.dealId);

  return `${appUrl.replace(/\/$/, "")}/book?${query.toString()}`;
}
