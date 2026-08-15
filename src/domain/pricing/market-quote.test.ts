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
    for (const size of product.sizes) size.amountInclTaxCents = 40_000;
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
