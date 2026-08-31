import { describe, expect, it } from "vitest";
import { defaultProductRegistry } from "@/domain/catalogue/product-registry";
import { buildRobots } from "./robots";
import { buildPublicSitemap } from "./sitemap";
import { generateMetadata as generateHomeMetadata } from "./page";
import { generateMetadata as generateShopMetadata } from "./shop/page";
import { generateMetadata as generateCanvasMetadata } from "./canvas/page";
import { generateMetadata as generateBannersMetadata } from "./banners/page";
import { metadata as galleryMetadata } from "./design-gallery/page";
import { metadata as howItWorksMetadata } from "./how-it-works/page";
import { metadata as aboutMetadata } from "./about/page";
import { metadata as contactMetadata } from "./contact/page";
import { metadata as helpMetadata } from "./help/page";
import { metadata as shippingMetadata } from "./shipping-delivery/page";
import { metadata as returnsRefundsMetadata } from "./returns-refunds/page";
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
import { buildPublicMetadata } from "@/server/seo/metadata";
import { getSiteUrl } from "@/server/seo/site-url";

describe("public SEO routes", () => {
  it("uses the approved default social card when the homepage is shared", async () => {
    const socialTitle = "R&R Gallery | Custom Canvas | Banners & Digital Oil Paintings NZ | Free Design Service";
    const socialImage = "https://rnrgallery.com/media/social/rr-gallery-social-share-2026.webp";
    const homeMetadata = await generateHomeMetadata();

    expect(homeMetadata.openGraph).toMatchObject({
      title: socialTitle,
      images: [{ url: socialImage }],
    });
    expect(homeMetadata.twitter).toMatchObject({
      title: socialTitle,
      images: [socialImage],
    });
  });

  it("publishes only the canonical .com origin in robots and the live sitemap", () => {
    const siteUrl = getSiteUrl();
    const sitemap = buildPublicSitemap(defaultProductRegistry, siteUrl);

    expect(buildRobots(siteUrl).sitemap).toBe("https://rnrgallery.com/sitemap.xml");
    expect(sitemap.every((entry) => entry.url.startsWith("https://rnrgallery.com/")))
      .toBe(true);
    expect(sitemap.some((entry) => entry.url.includes("rrgallery.co.nz"))).toBe(false);
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
    expect(urls).toContain("https://shop.example.test/returns-refunds");
    expect(urls).toContain("https://shop.example.test/custom-roll-up-banners-nz");
    expect(urls).toContain("https://shop.example.test/custom-wall-banners-nz");
    expect(urls).toContain("https://shop.example.test/custom-photo-canvas-nz");
    expect(urls).not.toContain(`https://shop.example.test/products/${registry.products[0].slug}`);
    expect(urls.some((url) => /\/(?:admin|account|cart|checkout|orders|pay)(?:\/|$)/.test(url))).toBe(false);
    expect(sitemap.every((entry) => entry.lastModified instanceof Date)).toBe(true);
    expect(urls.every((url) => !url.includes("?"))).toBe(true);
    expect(urls.some((url) => url.includes("/au"))).toBe(false);
    expect(sitemap.some((entry) => entry.alternates)).toBe(false);
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

    const sitemap = buildPublicSitemap(registry, new URL("https://shop.example.test"));
    const urls = sitemap.map((entry) => entry.url);

    expect(urls).toContain("https://shop.example.test/au");
    expect(urls).toContain("https://shop.example.test/au/shop");
    expect(urls).toContain("https://shop.example.test/au/canvas");
    expect(urls).toContain("https://shop.example.test/au/banners");
    for (const product of registry.products.filter((entry) => entry.active)) {
      expect(urls).toContain(`https://shop.example.test/au/products/${product.slug}`);
    }
    expect(urls.some((url) => url.includes("/au/products/") && url.includes("configure")))
      .toBe(false);
    expect(sitemap.find((entry) => entry.url === "https://shop.example.test/shop")?.alternates)
      .toEqual({
        languages: {
          "en-NZ": "https://shop.example.test/shop",
          "en-AU": "https://shop.example.test/au/shop",
          "x-default": "https://shop.example.test/shop",
        },
      });
    expect(sitemap.find((entry) => entry.url === "https://shop.example.test/au/shop")?.alternates)
      .toEqual({
        languages: {
          "en-NZ": "https://shop.example.test/shop",
          "en-AU": "https://shop.example.test/au/shop",
          "x-default": "https://shop.example.test/shop",
        },
      });
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
          "/products/*/configure",
        ]),
      }),
      {
        userAgent: "meta-externalagent",
        disallow: "/",
      },
    ]));
    expect(robots.rules).toEqual(expect.arrayContaining([
      expect.objectContaining({
        userAgent: "*",
        disallow: expect.not.arrayContaining(["/product/"]),
      }),
    ]));
  });

  it("keeps useful search, sharing and user-triggered crawlers on the public policy", () => {
    const robots = buildRobots(new URL("https://shop.example.test"));
    const rules = Array.isArray(robots.rules) ? robots.rules : [robots.rules];

    for (const userAgent of [
      "facebookexternalhit",
      "meta-webindexer",
      "meta-externalfetcher",
      "Googlebot",
      "Bingbot",
    ]) {
      expect(rules.some((rule) => rule.userAgent === userAgent)).toBe(false);
    }
  });

  it.each([
    ["home", generateHomeMetadata, "https://rnrgallery.com/"],
    ["shop", generateShopMetadata, "https://rnrgallery.com/shop"],
    ["canvas", generateCanvasMetadata, "https://rnrgallery.com/canvas"],
    ["banners", generateBannersMetadata, "https://rnrgallery.com/banners"],
    ["design gallery", () => galleryMetadata, "https://rnrgallery.com/design-gallery"],
    ["how it works", () => howItWorksMetadata, "https://rnrgallery.com/how-it-works"],
    ["about", () => aboutMetadata, "https://rnrgallery.com/about"],
    ["contact", () => contactMetadata, "https://rnrgallery.com/contact"],
    ["help", () => helpMetadata, "https://rnrgallery.com/help"],
    ["shipping", () => shippingMetadata, "https://rnrgallery.com/shipping-delivery"],
    ["returns and refunds", () => returnsRefundsMetadata, "https://rnrgallery.com/returns-refunds"],
    ["roll-up landing", () => rollUpLandingMetadata, "https://rnrgallery.com/custom-roll-up-banners-nz"],
    ["wall banner landing", () => wallBannerLandingMetadata, "https://rnrgallery.com/custom-wall-banners-nz"],
    ["photo canvas landing", () => photoCanvasLandingMetadata, "https://rnrgallery.com/custom-photo-canvas-nz"],
  ])("gives %s unique, indexable social metadata and an absolute canonical", async (_label, loadMetadata, canonical) => {
    const metadata = await loadMetadata();
    const expectedSocialTitle = _label === "home"
      ? "R&R Gallery | Custom Canvas | Banners & Digital Oil Paintings NZ | Free Design Service"
      : metadata.title;
    expect(metadata.title).toBeTruthy();
    expect(metadata.description).toBeTruthy();
    expect(metadata.alternates).toMatchObject({ canonical });
    expect(metadata.openGraph).toMatchObject({
      title: expectedSocialTitle,
      description: metadata.description,
      url: canonical,
    });
    expect(metadata.twitter).toMatchObject({
      card: "summary_large_image",
      title: expectedSocialTitle,
      description: metadata.description,
    });
    expect(metadata.robots).toMatchObject({ index: true, follow: true });
  });

  it("links only true NZ and AU route counterparts with self-referencing hreflang", async () => {
    const [homeMetadata, shopMetadata] = await Promise.all([
      generateHomeMetadata(),
      generateShopMetadata(),
    ]);
    expect(homeMetadata.alternates).toEqual({
      canonical: "https://rnrgallery.com/",
    });
    expect(shopMetadata.alternates).toEqual({
      canonical: "https://rnrgallery.com/shop",
    });
    expect(contactMetadata.alternates).toEqual({
      canonical: "https://rnrgallery.com/contact",
    });

    const productMetadata = buildPublicMetadata({
      title: "Product",
      description: "Product description",
      path: "/au/products/photo-print-canvas",
      image: "/media/products/photo-print-canvas.webp",
      imageAlt: "Photo print canvas",
      includeMarketAlternates: true,
    });
    expect(productMetadata.alternates).toEqual({
      canonical: "https://rnrgallery.com/au/products/photo-print-canvas",
      languages: {
        "en-NZ": "https://rnrgallery.com/products/photo-print-canvas",
        "en-AU": "https://rnrgallery.com/au/products/photo-print-canvas",
        "x-default": "https://rnrgallery.com/products/photo-print-canvas",
      },
    });
  });

  it("emits Australian hreflang only when the caller has confirmed public AU readiness", () => {
    const input = {
      title: "Product",
      description: "Product description",
      path: "/shop",
      image: "/media/products/photo-print-canvas.webp",
      imageAlt: "Photo print canvas",
    };

    expect(buildPublicMetadata(input).alternates).toEqual({
      canonical: "https://rnrgallery.com/shop",
    });
    expect(buildPublicMetadata({ ...input, includeMarketAlternates: true }).alternates)
      .toEqual({
        canonical: "https://rnrgallery.com/shop",
        languages: {
          "en-NZ": "https://rnrgallery.com/shop",
          "en-AU": "https://rnrgallery.com/au/shop",
          "x-default": "https://rnrgallery.com/shop",
        },
      });
  });

  it("does not reuse titles or descriptions across primary public routes", async () => {
    const [homeMetadata, shopMetadata, canvasMetadata, bannersMetadata] = await Promise.all([
      generateHomeMetadata(),
      generateShopMetadata(),
      generateCanvasMetadata(),
      generateBannersMetadata(),
    ]);
    const metadata = [homeMetadata, shopMetadata, canvasMetadata, bannersMetadata, galleryMetadata, howItWorksMetadata, aboutMetadata, contactMetadata, helpMetadata, shippingMetadata, returnsRefundsMetadata, rollUpLandingMetadata, wallBannerLandingMetadata, photoCanvasLandingMetadata];
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
