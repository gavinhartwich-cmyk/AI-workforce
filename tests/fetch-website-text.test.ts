import { describe, expect, it } from "vitest";
import { createFetchWebsiteTextTool } from "../src/tools/fetch-website-text.js";

function pageFetch(html: string): typeof fetch {
  return (async () => new Response(html, { status: 200 })) as typeof fetch;
}

async function runTool(html: string) {
  const tool = createFetchWebsiteTextTool(pageFetch(html));
  return tool.execute({ website: "https://example-hvac.test" });
}

describe("fetch_website_text", () => {
  it("drops nav, header and footer before truncating, keeping the real copy", async () => {
    // The cap used to be spent on whatever came first in the document,
    // which on most sites is a nav menu. Boilerplate is removed first so
    // the budget goes to text that says something about the business.
    const html = `
      <html><body>
        <nav>Home Services About Contact Careers Blog Financing Specials</nav>
        <header>Call us today! Serving the area since 1998</header>
        <main>We install and repair furnaces and air conditioners for homes in Winnipeg.</main>
        <footer>Privacy Policy Terms Sitemap Copyright 2026</footer>
      </body></html>`;

    const result = await runTool(html);

    expect(result.text).toContain("install and repair furnaces");
    expect(result.text).not.toContain("Careers");
    expect(result.text).not.toContain("Privacy Policy");
    expect(result.text).not.toContain("Serving the area since 1998");
  });

  it("still finds a contact email hidden in the footer it strips", async () => {
    // The email scrape deliberately reads the RAW html, not the stripped
    // text — a business's only address is very often in the footer, so
    // removing footers for the model must not cost us the contact.
    const html = `
      <html><body>
        <main>Furnace repair and AC installation.</main>
        <footer>Questions? <a href="mailto:office@example-hvac.test">Email us</a></footer>
      </body></html>`;

    const result = await runTool(html);

    expect(result.fallbackEmail).toBe("office@example-hvac.test");
    expect(result.text).not.toContain("Questions?");
  });

  it("caps the text it returns", async () => {
    const html = `<html><body><main>${"word ".repeat(5000)}</main></body></html>`;

    const result = await runTool(html);

    expect(result.text!.length).toBeLessThanOrEqual(4000);
  });

  it("returns nulls rather than throwing when the fetch fails", async () => {
    const failing = (async () => {
      throw new Error("ENOTFOUND");
    }) as typeof fetch;
    const tool = createFetchWebsiteTextTool(failing);

    // Research runs on Places data alone when a site can't be read — a dead
    // website must not take the whole candidate down with it.
    await expect(tool.execute({ website: "https://nope.test" })).resolves.toEqual({
      text: null,
      fallbackEmail: null,
    });
  });
});
