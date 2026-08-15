import { describe, expect, it } from "vitest";
import { defaultProductRegistry } from "@/domain/catalogue/product-registry";
import { buildRobots } from "./robots";
import { buildPublicSitemap } from "./sitemap";
import { metadata as homeMetadata } from "./page";
import { metadata as shopMetadata } from "./shop/page";
import { metadata as canvasMetadata } from "./canvas/page";
import { metadata as bannersMetadata } from "./banners/page";
import { metadata as galleryMetadata } from "./design-gallery/page";
import { metadata as howItWorksMetadata } from "./how-it-works/page";
import { metadata as accountMetadata } from "./account/layout";
import { metadata as adminMetadata } from "./admin/layout";
import { metadata as formsMetadata } from "./forms/layout";
import { metadata as cartMetadata } from "./cart/page";
import { metadata as checkoutMetadata } from "./checkout/page";
import { metadata as orderMetadata } from "./orders/[orderNumber]/page";
import { metadata as proofMetadata } from "./orders/[orderNumber]/proof/page";

describe("public SEO routes", () => {
  it("lists active public products and excludes private commerce surfaces", () => {
    const registry = structuredClone(defaultProductRegistry);
    registry.products[0].active = false;
    const sitemap = buildPublicSitemap(registry, new URL("https://shop.example.test"), [{
      slug: "40th-birthday-a1b2c3d4",
      createdAt: new Date("2026-08-10T00:00:00Z"),
    }]);
    const urls = sitemap.map((entry) => entry.url);

    expect(urls).toContain("https://shop.example.test/");
    expect(urls).toContain("https://shop.example.test/products/digital-oil-painting-canvas");
    expect(urls).toContain("https://shop.example.test/designs/40th-birthday-a1b2c3d4");
    expect(urls).not.toContain(`https://shop.example.test/products/${registry.products[0].slug}`);
    expect(urls.some((url) => /\/(?:admin|account|cart|checkout|orders)(?:\/|$)/.test(url))).toBe(false);
    expect(sitemap.every((entry) => entry.lastModified instanceof Date)).toBe(true);
    expect(urls.every((url) => !url.includes("?"))).toBe(true);
  });

  it("keeps private, transactional and duplicate legacy routes out of crawling", () => {
    const robots = buildRobots(new URL("https://shop.example.test"));
    expect(robots.sitemap).toBe("https://shop.example.test/sitemap.xml");
    expect(robots.rules).toEqual(expect.arrayContaining([
      expect.objectContaining({
        userAgent: "*",
        allow: "/",
        disallow: expect.arrayContaining([
          "/admin/",
          "/account/",
          "/api/",
          "/cart",
          "/checkout",
          "/forms/",
          "/orders/",
          "/product/",
          "/products/*/configure",
        ]),
      }),
    ]));
  });

  it.each([
    ["home", homeMetadata, "https://rrgallery.co.nz/"],
    ["shop", shopMetadata, "https://rrgallery.co.nz/shop"],
    ["canvas", canvasMetadata, "https://rrgallery.co.nz/canvas"],
    ["banners", bannersMetadata, "https://rrgallery.co.nz/banners"],
    ["design gallery", galleryMetadata, "https://rrgallery.co.nz/design-gallery"],
    ["how it works", howItWorksMetadata, "https://rrgallery.co.nz/how-it-works"],
  ])("gives %s unique, indexable social metadata and an absolute canonical", (_label, metadata, canonical) => {
    expect(metadata.title).toBeTruthy();
    expect(metadata.description).toBeTruthy();
    expect(metadata.alternates).toMatchObject({ canonical });
    expect(metadata.openGraph).toMatchObject({
      title: metadata.title,
      description: metadata.description,
      url: canonical,
    });
    expect(metadata.twitter).toMatchObject({
      card: "summary_large_image",
      title: metadata.title,
      description: metadata.description,
    });
    expect(metadata.robots).toMatchObject({ index: true, follow: true });
  });

  it("does not reuse titles or descriptions across primary public routes", () => {
    const metadata = [homeMetadata, shopMetadata, canvasMetadata, bannersMetadata, galleryMetadata, howItWorksMetadata];
    expect(new Set(metadata.map((entry) => entry.title)).size).toBe(metadata.length);
    expect(new Set(metadata.map((entry) => entry.description)).size).toBe(metadata.length);
  });

  it.each([
    ["account", accountMetadata],
    ["admin", adminMetadata],
    ["forms", formsMetadata],
    ["cart", cartMetadata],
    ["checkout", checkoutMetadata],
    ["order", orderMetadata],
    ["proof", proofMetadata],
  ])("keeps the %s surface out of search indexes", (_label, metadata) => {
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });
});
