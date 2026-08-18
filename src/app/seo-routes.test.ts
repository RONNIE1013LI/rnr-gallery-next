import { describe, expect, it } from "vitest";
import { defaultProductRegistry } from "@/domain/catalogue/product-registry";
import { buildRobots } from "./robots";
import { buildPublicSitemap, dynamic as sitemapDynamic } from "./sitemap";
import { metadata as homeMetadata } from "./page";
import { metadata as shopMetadata } from "./shop/page";
import { metadata as canvasMetadata } from "./canvas/page";
import { metadata as bannersMetadata } from "./banners/page";
import { metadata as galleryMetadata } from "./design-gallery/page";
import { metadata as howItWorksMetadata } from "./how-it-works/page";
import { metadata as aboutMetadata } from "./about/page";
import { metadata as contactMetadata } from "./contact/page";
import { metadata as helpMetadata } from "./help/page";
import { metadata as shippingMetadata } from "./shipping-delivery/page";
import { metadata as rollUpLandingMetadata } from "./custom-roll-up-banners-nz/page";
import { metadata as wallBannerLandingMetadata } from "./custom-wall-banners-nz/page";
import { metadata as photoCanvasLandingMetadata } from "./custom-photo-canvas-nz/page";
import { metadata as accountMetadata } from "./account/layout";
import { metadata as adminMetadata } from "./admin/layout";
import { metadata as formsMetadata } from "./forms/layout";
import { metadata as cartMetadata } from "./cart/page";
import { metadata as checkoutMetadata } from "./checkout/page";
import { metadata as orderMetadata } from "./orders/[orderNumber]/page";
import { metadata as proofMetadata } from "./orders/[orderNumber]/proof/page";

describe("public SEO routes", () => {
  it("renders the sitemap from the current market registry instead of a build-time snapshot", () => {
    expect(sitemapDynamic).toBe("force-dynamic");
  });

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
    expect(urls).toContain("https://shop.example.test/about");
    expect(urls).toContain("https://shop.example.test/contact");
    expect(urls).toContain("https://shop.example.test/help");
    expect(urls).toContain("https://shop.example.test/shipping-delivery");
    expect(urls).toContain("https://shop.example.test/custom-roll-up-banners-nz");
    expect(urls).toContain("https://shop.example.test/custom-wall-banners-nz");
    expect(urls).toContain("https://shop.example.test/custom-photo-canvas-nz");
    expect(urls).not.toContain(`https://shop.example.test/products/${registry.products[0].slug}`);
    expect(urls.some((url) => /\/(?:admin|account|cart|checkout|orders|pay)(?:\/|$)/.test(url))).toBe(false);
    expect(sitemap.every((entry) => entry.lastModified instanceof Date)).toBe(true);
    expect(urls.every((url) => !url.includes("?"))).toBe(true);
    expect(urls.some((url) => url.includes("/au"))).toBe(false);
  });

  it("lists Australian routes only after the fixed AUD price book is complete and enabled", () => {
    const registry = structuredClone(defaultProductRegistry);
    registry.markets.AU.enabled = true;
    for (const product of registry.markets.AU.products) {
      for (const size of product.sizes) size.amountInclTaxCents = 20_000;
      for (const charge of product.charges) charge.amountInclTaxCents = 1_000;
    }
    for (const fee of registry.markets.AU.peoplePets.fees) fee.amountInclTaxCents = 1_000;
    registry.markets.AU.peoplePets.additionalEachInclTaxCents = 500;
    for (const fee of registry.markets.AU.urgentServiceFees) fee.amountInclTaxCents = 2_000;
    for (const shipping of registry.markets.AU.shippingMethods) {
      if (shipping.source === "fixed") shipping.amountInclTaxCents = 3_000;
    }

    const urls = buildPublicSitemap(registry, new URL("https://shop.example.test"))
      .map((entry) => entry.url);

    expect(urls).toContain("https://shop.example.test/au");
    expect(urls).toContain("https://shop.example.test/au/shop");
    expect(urls).toContain("https://shop.example.test/au/canvas");
    expect(urls).toContain("https://shop.example.test/au/banners");
    for (const product of registry.products.filter((entry) => entry.active)) {
      expect(urls).toContain(`https://shop.example.test/au/products/${product.slug}`);
    }
    expect(urls.some((url) => url.includes("/au/products/") && url.includes("configure")))
      .toBe(false);
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
          "/pay/",
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
    ["about", aboutMetadata, "https://rrgallery.co.nz/about"],
    ["contact", contactMetadata, "https://rrgallery.co.nz/contact"],
    ["help", helpMetadata, "https://rrgallery.co.nz/help"],
    ["shipping", shippingMetadata, "https://rrgallery.co.nz/shipping-delivery"],
    ["roll-up landing", rollUpLandingMetadata, "https://rrgallery.co.nz/custom-roll-up-banners-nz"],
    ["wall banner landing", wallBannerLandingMetadata, "https://rrgallery.co.nz/custom-wall-banners-nz"],
    ["photo canvas landing", photoCanvasLandingMetadata, "https://rrgallery.co.nz/custom-photo-canvas-nz"],
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
    const metadata = [homeMetadata, shopMetadata, canvasMetadata, bannersMetadata, galleryMetadata, howItWorksMetadata, aboutMetadata, contactMetadata, helpMetadata, shippingMetadata, rollUpLandingMetadata, wallBannerLandingMetadata, photoCanvasLandingMetadata];
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
