import { describe, expect, it } from "vitest";
import {
  assertMarketCheckoutReady,
  getMarketCompleteness,
} from "./market-price-book";
import {
  defaultProductRegistry,
  parseProductRegistry,
} from "./product-registry";

function legacyVersionOneRegistry(): unknown {
  const legacy = structuredClone(defaultProductRegistry) as unknown as Record<string, unknown>;
  legacy.schemaVersion = 1;
  delete legacy.markets;
  return legacy;
}

function completeAustraliaDraft(): typeof defaultProductRegistry {
  const draft = structuredClone(defaultProductRegistry);
  const australia = draft.markets.AU;
  for (const product of australia.products) {
    for (const size of product.sizes) size.amountInclTaxCents = 40_000;
    for (const charge of product.charges) charge.amountInclTaxCents = 2_000;
  }
  for (const fee of australia.peoplePets.fees) fee.amountInclTaxCents = 5_000;
  australia.peoplePets.additionalEachInclTaxCents = 3_000;
  for (const fee of australia.urgentServiceFees) fee.amountInclTaxCents = 9_000;
  for (const shipping of australia.shippingMethods) {
    if (shipping.source === "fixed") shipping.amountInclTaxCents = 3_500;
  }
  australia.enabled = true;
  return draft;
}

describe("market price books", () => {
  it("migrates the legacy NZ registry without changing final retail prices", () => {
    const migrated = parseProductRegistry(legacyVersionOneRegistry());
    const rollUp = migrated.markets.NZ.products.find(
      (product) => product.productKey === "roll-up-banner",
    );

    expect(migrated.schemaVersion).toBe(2);
    expect(
      rollUp?.sizes.find((size) => size.sizeKey === "standard")?.amountInclTaxCents,
    ).toBe(26_450);
    expect(getMarketCompleteness(migrated, "NZ")).toEqual({
      ready: true,
      missingKeys: [],
    });
  });

  it("never generates Australian commercial prices from NZ prices", () => {
    const migrated = parseProductRegistry(legacyVersionOneRegistry());
    const rollUp = migrated.markets.AU.products.find(
      (product) => product.productKey === "roll-up-banner",
    );

    expect(migrated.markets.AU.enabled).toBe(false);
    expect(
      rollUp?.sizes.find((size) => size.sizeKey === "standard")?.amountInclTaxCents,
    ).toBeNull();
    expect(getMarketCompleteness(migrated, "AU")).toMatchObject({ ready: false });
    expect(getMarketCompleteness(migrated, "AU").missingKeys).toContain(
      "products.roll-up-banner.sizes.standard",
    );
  });

  it("fails checkout closed while AU is disabled or incomplete", () => {
    expect(() => assertMarketCheckoutReady(defaultProductRegistry, "AU")).toThrow(
      "Australia market is disabled",
    );

    const incomplete = structuredClone(defaultProductRegistry);
    incomplete.markets.AU.enabled = true;
    expect(() => parseProductRegistry(incomplete)).toThrow(
      "Australia price book is incomplete",
    );
  });

  it("accepts an explicitly completed Australian price book", () => {
    const parsed = parseProductRegistry(completeAustraliaDraft());

    expect(getMarketCompleteness(parsed, "AU")).toEqual({
      ready: true,
      missingKeys: [],
    });
    expect(() => assertMarketCheckoutReady(parsed, "AU")).not.toThrow();
  });
});
