import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildBookingLink } from "../src/outreach/booking-link.js";

describe("buildBookingLink", () => {
  const original = process.env.HARTWICH_APP_URL;
  beforeEach(() => {
    process.env.HARTWICH_APP_URL = "https://hartwich-os.example.com";
  });
  afterEach(() => {
    process.env.HARTWICH_APP_URL = original;
  });

  it("builds a link with all three query params", () => {
    const link = buildBookingLink({ companyId: "c1", contactId: "k1", dealId: "d1" });
    expect(link).toBe("https://hartwich-os.example.com/book?company=c1&contact=k1&deal=d1");
  });

  it("omits null params", () => {
    const link = buildBookingLink({ companyId: "c1", contactId: null, dealId: null });
    expect(link).toBe("https://hartwich-os.example.com/book?company=c1");
  });

  it("strips a trailing slash from the app URL", () => {
    process.env.HARTWICH_APP_URL = "https://hartwich-os.example.com/";
    const link = buildBookingLink({ companyId: "c1", contactId: null, dealId: null });
    expect(link).toBe("https://hartwich-os.example.com/book?company=c1");
  });

  it("throws a clear error when HARTWICH_APP_URL isn't set", () => {
    delete process.env.HARTWICH_APP_URL;
    expect(() => buildBookingLink({ companyId: "c1", contactId: null, dealId: null })).toThrow(/HARTWICH_APP_URL/);
  });
});
