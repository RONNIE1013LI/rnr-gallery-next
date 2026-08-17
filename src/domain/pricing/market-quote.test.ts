import { describe, expect, it } from "vitest";
import { defaultProductRegistry, parseProductRegistry } from "@/domain/catalogue/product-registry";
import {
  getMarketStartingPriceInclTaxCents,
  quoteMarketConfiguration,
} from "./market-quote";

function enabledAustraliaRegistry(registered: boolean) {
  const registry = structuredClone(defaultProductRegistry);
  const australia = registry.markets.AU;
  for (const product of australia.products) {
    if (product.productKey !== "banner-bundle") {
      for (const size of product.sizes) size.amountInclTaxCents = 40_000;
    }
    for (const charge of product.charges) charge.amountInclTaxCents = 3_000;
  }
  const rollUp = australia.products.find((product) => product.productKey === "roll-up-banner")!;
  rollUp.sizes.find((size) => size.sizeKey === "standard")!.amountInclTaxCents = 32_000;
  for (const fee of australia.peoplePets.fees) fee.amountInclTaxCents = fee.count * 6_000;
  australia.peoplePets.additionalEachInclTaxCents = 4_000;
  for (const fee of australia.urgentServiceFees) fee.amountInclTaxCents = 10_000;
  for (const shipping of australia.shippingMethods) shipping.amountInclTaxCents = 4_500;
  australia.tax.registered = registered;
  australia.enabled = true;
  return parseProductRegistry(registry);
}

describe("market configuration quote", () => {
  it.each([
    ["NZ", "rollup-wall-200x100", 35_999],
    ["NZ", "rollup-wall-300x150", 48_999],
  ] as const)("uses the fixed %s Banner Bundle base price for %s", (market, sizeKey, total) => {
    const quote = quoteMarketConfiguration(
      defaultProductRegistry,
      market,
      "banner-bundle",
      { sizeKey, peoplePets: 0 },
    );

    expect(quote.totalInclGstCents).toBe(total);
    expect(quote.lines[0]).toMatchObject({ amountInclGstCents: total });
  });

  it("uses the fixed small Banner Bundle AUD base price", () => {
    const quote = quoteMarketConfiguration(
      enabledAustraliaRegistry(false),
      "AU",
      "banner-bundle",
      { sizeKey: "rollup-wall-200x100", peoplePets: 0 },
    );

    expect(quote.totalInclGstCents).toBe(33_999);
  });

  it("prices Roll-Up and Wall Banner extra photos as separate component lines", () => {
    const quote = quoteMarketConfiguration(
      defaultProductRegistry,
      "NZ",
      "banner-bundle",
      {
        sizeKey: "rollup-wall-200x100",
        peoplePets: 0,
        bundleCounts: {
          rollUpExtraPhotos: 1,
          wallBannerExtraPhotos: 2,
          rollUpBackgroundRemovals: 0,
          wallBannerBackgroundRemovals: 0,
        },
      },
    );

    expect(quote.lines).toEqual([
      {
        key: "product-size",
        label: "Product / size price",
        amountExGstCents: 31_303,
        amountInclGstCents: 35_999,
      },
      {
        key: "roll-up-extra-photos",
        label: "Roll-Up Banner extra photos",
        amountExGstCents: 500,
      },
      {
        key: "wall-banner-extra-photos",
        label: "Wall Banner extra photos",
        amountExGstCents: 1_000,
      },
    ]);
    expect(quote.totalInclGstCents).toBe(37_724);
  });

  it("prices Roll-Up and Wall Banner background removals as separate gross lines", () => {
    const quote = quoteMarketConfiguration(
      defaultProductRegistry,
      "NZ",
      "banner-bundle",
      {
        sizeKey: "rollup-wall-200x100",
        peoplePets: 0,
        bundleCounts: {
          rollUpExtraPhotos: 0,
          wallBannerExtraPhotos: 0,
          rollUpBackgroundRemovals: 1,
          wallBannerBackgroundRemovals: 2,
        },
      },
    );

    expect(quote.lines).toEqual([
      {
        key: "product-size",
        label: "Product / size price",
        amountExGstCents: 31_303,
        amountInclGstCents: 35_999,
      },
      {
        key: "roll-up-background-removals",
        label: "Roll-Up Banner background removals",
        amountExGstCents: 1_739,
        amountInclGstCents: 2_000,
      },
      {
        key: "wall-banner-background-removals",
        label: "Wall Banner background removals",
        amountExGstCents: 3_478,
        amountInclGstCents: 4_000,
      },
    ]);
    expect(quote.totalInclGstCents).toBe(41_999);
  });

  it("uses manually stored AUD prices rather than NZ retail prices", () => {
    const quote = quoteMarketConfiguration(
      enabledAustraliaRegistry(false),
      "AU",
      "roll-up-banner",
      {
        sizeKey: "standard",
        peoplePets: 0,
        sourcePhotoCount: 7,
        extraBackgroundRemovalCount: 1,
      },
    );

    expect(quote).toMatchObject({
      market: "AU",
      currency: "AUD",
      taxJurisdiction: "NONE",
      taxRateBasisPoints: 1_000,
      subtotalExGstCents: 41_000,
      gstCents: 0,
      totalInclGstCents: 41_000,
      discountCents: 0,
      designSurchargeCents: 0,
    });
  });

  it("extracts AU GST from the fixed gross price without changing it", () => {
    const quote = quoteMarketConfiguration(
      enabledAustraliaRegistry(true),
      "AU",
      "roll-up-banner",
      { sizeKey: "standard", peoplePets: 0 },
    );

    expect(quote.totalInclGstCents).toBe(32_000);
    expect(quote.subtotalExGstCents + quote.gstCents).toBe(32_000);
    expect(quote.taxJurisdiction).toBe("AU_GST");
  });

  it("refuses to quote the disabled incomplete Australia price book", () => {
    expect(() => quoteMarketConfiguration(
      defaultProductRegistry,
      "AU",
      "roll-up-banner",
      { sizeKey: "standard", peoplePets: 0 },
    )).toThrow("Australia market is disabled");
  });

  it("uses the market price book for storefront starting prices", () => {
    const registry = enabledAustraliaRegistry(false);

    expect(getMarketStartingPriceInclTaxCents(
      registry,
      "AU",
      "roll-up-banner",
    )).toBe(32_000);
    expect(getMarketStartingPriceInclTaxCents(
      registry,
      "AU",
      "digital-oil-painting-canvas",
    )).toBe(46_000);
  });
});
