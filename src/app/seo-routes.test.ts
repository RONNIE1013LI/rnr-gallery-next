import { describe, expect, it } from "vitest";
import { defaultProductRegistry } from "@/domain/catalogue/product-registry";
import { buildRobots } from "./robots";
import { buildPublicSitemap } from "./sitemap";

describe("public SEO routes", () => {
  it("lists active public products and excludes private commerce surfaces", () => {
    const registry = structuredClone(defaultProductRegistry);
    registry.products[0].active = false;
    const sitemap = buildPublicSitemap(registry, new URL("https://shop.example.test"));
    const urls = sitemap.map((entry) => entry.url);

    expect(urls).toContain("https://shop.example.test/");
    expect(urls).toContain("https://shop.example.test/products/digital-oil-painting-canvas");
    expect(urls).not.toContain(`https://shop.example.test/products/${registry.products[0].slug}`);
    expect(urls.some((url) => /\/(?:admin|account|cart|checkout|orders)(?:\/|$)/.test(url))).toBe(false);
  });

  it("keeps private, transactional and duplicate legacy routes out of crawling", () => {
    const robots = buildRobots(new URL("https://shop.example.test"));
    expect(robots.sitemap).toBe("https://shop.example.test/sitemap.xml");
    expect(robots.rules).toEqual(expect.arrayContaining([
      expect.objectContaining({
        userAgent: "*",
        allow: "/",
        disallow: expect.arrayContaining(["/admin/", "/account/", "/api/", "/cart", "/checkout", "/orders/", "/product/"]),
      }),
    ]));
  });
});
