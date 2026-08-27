import { describe, expect, it } from "vitest";
import { defaultProductRegistry } from "./product-registry";
import {
  buildMerchantProductData,
  MERCHANT_ADVERTISING_SAFE_IMAGE_BY_PRODUCT_KEY,
} from "./merchant-product-data";

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

  it("emits only advertising-safe product families with their approved neutral image", () => {
    const items = buildMerchantProductData(
      defaultProductRegistry,
      "NZ",
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
    const approvedImage = "https://rnrgallery.com/media/home/homepage-begin-product-formats-v2.webp";

    expect(Object.keys(MERCHANT_ADVERTISING_SAFE_IMAGE_BY_PRODUCT_KEY)).toEqual(approvedProductKeys);
    expect(new Set(items.map((item) => item.productKey))).toEqual(new Set(approvedProductKeys));
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ imageLink: approvedImage }),
    ]));
    expect(items.every((item) => item.imageLink === approvedImage)).toBe(true);
    expect(items.some((item) => item.productKey === "grave-cover")).toBe(false);
    expect(items.some((item) => item.productKey === "banner-bundle")).toBe(false);
    for (const productKey of approvedProductKeys) {
      const variants = items.filter((item) => item.productKey === productKey);
      expect(new Set(variants.map((item) => item.itemGroupId))).toEqual(
        new Set([`nz:${productKey}`]),
      );
    }
  });

  it("does not generate Australian feed data while the market is closed", () => {
    expect(() => buildMerchantProductData(
      defaultProductRegistry,
      "AU",
      new URL("https://rnrgallery.com"),
    )).toThrow("Australia market is disabled");
  });
});
