import { describe, expect, it } from "vitest";
import { defaultProductRegistry } from "./product-registry";
import { buildMerchantProductData } from "./merchant-product-data";

function readyAustralianRegistry() {
  const registry = structuredClone(defaultProductRegistry);
  registry.markets.AU.enabled = true;
  for (const product of registry.markets.AU.products) {
    for (const [index, size] of product.sizes.entries()) {
      size.amountInclTaxCents = 20_000 + index * 1_000;
    }
    for (const charge of product.charges) charge.amountInclTaxCents = 1_000;
  }
  for (const fee of registry.markets.AU.peoplePets.fees) fee.amountInclTaxCents = 1_000;
  registry.markets.AU.peoplePets.additionalEachInclTaxCents = 500;
  for (const fee of registry.markets.AU.urgentServiceFees) fee.amountInclTaxCents = 2_000;
  for (const shipping of registry.markets.AU.shippingMethods) {
    if (shipping.source === "fixed") shipping.amountInclTaxCents = 3_000;
  }
  return registry;
}

describe("merchant product data", () => {
  it("uses fixed market price-book amounts without currency conversion", () => {
    const registry = readyAustralianRegistry();
    const items = buildMerchantProductData(
      registry,
      "AU",
      new URL("https://rnrgallery.com"),
    );
    const item = items.find((entry) =>
      entry.productKey === registry.products[0].key &&
      entry.sizeKey === registry.products[0].configuration.sizes[0].key
    );

    expect(item).toMatchObject({
      currency: "AUD",
      priceInclTaxCents: 20_000,
      link: `https://rnrgallery.com/au/products/${registry.products[0].slug}?size=${registry.products[0].configuration.sizes[0].key}`,
      id: `au:${registry.products[0].key}:${registry.products[0].configuration.sizes[0].key}`,
      itemGroupId: `au:${registry.products[0].key}`,
      size: registry.products[0].configuration.sizes[0].label,
      brand: "R&R Gallery",
      condition: "new",
      identifierExists: false,
      shippingLabel: "AU",
    });
    expect(item?.link).not.toContain("/configure");
    expect(item?.imageLink).toMatch(/^https:\/\/rnrgallery\.com\/media\//);
  });

  it("includes the required default people or pet charge in variant feed prices", () => {
    const registry = readyAustralianRegistry();
    const product = registry.products.find(
      (entry) => entry.configuration.peoplePetsMode === "required",
    )!;
    const size = product.configuration.sizes[0];
    const item = buildMerchantProductData(
      registry,
      "AU",
      new URL("https://rnrgallery.com"),
    ).find((entry) => entry.productKey === product.key && entry.sizeKey === size.key);

    expect(item).toMatchObject({
      currency: "AUD",
      priceInclTaxCents: 21_000,
      link: `https://rnrgallery.com/au/products/${product.slug}?size=${size.key}`,
    });
  });

  it.each([
    ["NZ", defaultProductRegistry],
    ["AU", readyAustralianRegistry()],
  ] as const)("excludes Banner Bundle from the %s Merchant feed while retaining other active products", (
    market,
    registry,
  ) => {
    const items = buildMerchantProductData(
      registry,
      market,
      new URL("https://rnrgallery.com"),
    );

    expect(items.some((entry) => entry.productKey === "banner-bundle")).toBe(false);
    expect(items.some((entry) => entry.link.includes("banner-bundle"))).toBe(false);
    expect(items.some((entry) => entry.productKey === "roll-up-banner")).toBe(true);
  });

  it.each([
    ["NZ", defaultProductRegistry],
    ["AU", readyAustralianRegistry()],
  ] as const)("uses each included product's current catalogue image in the %s feed", (market, registry) => {
    const items = buildMerchantProductData(
      registry,
      market,
      new URL("https://rnrgallery.com"),
    );
    const approvedProductKeys = [
      "photo-print-canvas",
      "digital-oil-painting-canvas",
      "custom-themed-canvas",
      "roll-up-banner",
      "custom-themed-wall-banner",
      "digital-oil-painting-banner",
    ];
    expect(new Set(items.map((item) => item.productKey))).toEqual(new Set(approvedProductKeys));
    expect(new Set(items.map((item) => item.imageLink)).size).toBe(approvedProductKeys.length);
    expect(items.some((item) => item.productKey === "grave-cover")).toBe(false);
    expect(items.some((item) => item.productKey === "banner-bundle")).toBe(false);
    for (const productKey of approvedProductKeys) {
      const variants = items.filter((item) => item.productKey === productKey);
      const product = registry.products.find((entry) => entry.key === productKey)!;
      expect(variants.every((item) => item.imageLink === new URL(product.image.src, "https://rnrgallery.com").toString())).toBe(true);
      expect(new Set(variants.map((item) => item.itemGroupId))).toEqual(
        new Set([`${market.toLowerCase()}:${productKey}`]),
      );
    }
  });

  it("follows catalogue image updates instead of retaining an old feed image", () => {
    const registry = structuredClone(defaultProductRegistry);
    const product = registry.products.find((entry) => entry.key === "roll-up-banner")!;
    product.image.src = "/media/products/roll-up-banner-updated.webp";

    const items = buildMerchantProductData(registry, "NZ", new URL("https://rnrgallery.com"));

    expect(items.find((item) => item.productKey === product.key)?.imageLink).toBe(
      "https://rnrgallery.com/media/products/roll-up-banner-updated.webp",
    );
  });

  it("does not generate Australian feed data while the market is closed", () => {
    expect(() => buildMerchantProductData(
      defaultProductRegistry,
      "AU",
      new URL("https://rnrgallery.com"),
    )).toThrow("Australia market is disabled");
  });
});
