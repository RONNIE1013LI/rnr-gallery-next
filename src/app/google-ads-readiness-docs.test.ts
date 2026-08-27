import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("Google Ads readiness delivery records", () => {
  it("keeps completed work separate from disabled and externally blocked work", () => {
    const document = readFileSync(resolve(root, "docs/google-ads-readiness-code.md"), "utf8");
    for (const heading of [
      "Completed in code",
      "Ready but disabled",
      "Waiting for account access",
      "Waiting for business decision",
      "Waiting for legal/policy approval",
      "Waiting for customer marketing permission",
    ]) expect(document).toContain(`## ${heading}`);
    expect(document).toContain("does not claim that Google Ads");
  });

  it("records the audited legacy URL inventory without blanket homepage redirects", () => {
    const csv = readFileSync(resolve(root, "docs/seo/legacy-url-map.csv"), "utf8");
    const [header, ...rows] = csv.trim().split("\n").map((line) => line.split(","));
    const byOldUrl = new Map(rows.map((row) => [row[0], row]));
    const activeRedirects = rows.filter((row) => row[3] === "301");

    expect(header).toEqual([
      "old_url",
      "new_url",
      "classification",
      "redirect_status",
      "confidence",
      "inventory_source",
      "reason",
    ]);
    expect(activeRedirects).toHaveLength(41);

    for (const [oldUrl, newUrl] of [
      ["https://rnrgallery.com/gallery/", "https://rnrgallery.com/design-gallery"],
      ["https://rnrgallery.com/about-rr/", "https://rnrgallery.com/about"],
      ["https://rnrgallery.com/product-category/canvas/", "https://rnrgallery.com/canvas"],
      ["https://rnrgallery.com/product-category/banner/", "https://rnrgallery.com/banners"],
      ["https://rnrgallery.com/product-category/banner/roll-up-banner/", "https://rnrgallery.com/products/roll-up-banner"],
      ["https://rnrgallery.com/product/digital-oil-painting-with-canvas/", "https://rnrgallery.com/products/digital-oil-painting-canvas"],
      ["https://rnrgallery.com/product/banner-bundle/", "https://rnrgallery.com/products/banner-bundle"],
    ]) {
      expect(byOldUrl.get(oldUrl)?.slice(0, 5)).toEqual([
        oldUrl,
        newUrl,
        "exact-301",
        "301",
        "high",
      ]);
    }

    expect(byOldUrl.get("https://rnrgallery.com/cookies-policy/")?.slice(0, 5)).toEqual([
      "https://rnrgallery.com/cookies-policy/",
      "https://rnrgallery.com/privacy",
      "exact-301",
      "301",
      "high",
    ]);
    expect(byOldUrl.get("https://rnrgallery.com/elementor-5897/")?.slice(0, 4)).toEqual([
      "https://rnrgallery.com/elementor-5897/",
      "",
      "intentional-404",
      "404",
    ]);
    expect(byOldUrl.get("https://rnrgallery.com/product/digital-oil-painting-digital-copy-only/")?.slice(0, 4)).toEqual([
        "https://rnrgallery.com/product/digital-oil-painting-digital-copy-only/",
        "",
        "intentional-404",
        "404",
      ]);
    expect(rows.some((row) => row[2] === "retire-candidate")).toBe(false);
    expect(rows.filter((row) => row[3] === "404").every((row) => row[1] === "" || row[4] === "low"))
      .toBe(true);
    expect(activeRedirects.some((row) => row[0] === "https://rnrgallery.com/")).toBe(false);
    expect(activeRedirects.some((row) => row[1] === "https://rnrgallery.com/")).toBe(false);
    expect(activeRedirects.every((row) => !row[0].includes(":path*"))).toBe(true);
  });
});
