import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildCompanyUrl } from "../src/outreach/app-url.js";

describe("buildCompanyUrl", () => {
  const original = process.env.HARTWICH_APP_URL;
  beforeEach(() => {
    process.env.HARTWICH_APP_URL = "https://hartwich-os.example.com";
  });
  afterEach(() => {
    process.env.HARTWICH_APP_URL = original;
  });

  it("builds a link to the company's page", () => {
    const link = buildCompanyUrl("11111111-1111-4111-8111-111111111111");
    expect(link).toBe("https://hartwich-os.example.com/companies/11111111-1111-4111-8111-111111111111");
  });

  it("strips a trailing slash from the app URL", () => {
    process.env.HARTWICH_APP_URL = "https://hartwich-os.example.com/";
    const link = buildCompanyUrl("c1");
    expect(link).toBe("https://hartwich-os.example.com/companies/c1");
  });

  it("throws a clear error when HARTWICH_APP_URL isn't set", () => {
    delete process.env.HARTWICH_APP_URL;
    expect(() => buildCompanyUrl("c1")).toThrow(/HARTWICH_APP_URL/);
  });
});
