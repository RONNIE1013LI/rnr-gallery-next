import { describe, expect, it } from "vitest";
import {
  currencyForMarket,
  includedTaxFromGross,
  marketSwitchDestination,
  marketForCountry,
  marketTaxPolicy,
} from "./market";

describe("market primitives", () => {
  it.each([
    ["NZ", "NZ", "NZD"],
    ["AU", "AU", "AUD"],
  ] as const)("maps %s destinations to the correct market and currency", (
    country,
    market,
    currency,
  ) => {
    expect(marketForCountry(country)).toBe(market);
    expect(currencyForMarket(market)).toBe(currency);
  });

  it("defines NZ as GST registered at 15 percent", () => {
    expect(marketTaxPolicy("NZ")).toEqual({
      jurisdiction: "NZ_GST",
      registered: true,
      rateBasisPoints: 1_500,
    });
    expect(includedTaxFromGross(26_450, marketTaxPolicy("NZ"))).toEqual({
      amountExTaxCents: 23_000,
      taxCents: 3_450,
      amountInclTaxCents: 26_450,
    });
  });

  it("does not extract tax for an unregistered Australian market", () => {
    const policy = marketTaxPolicy("AU", {
      registered: false,
      rateBasisPoints: 1_000,
    });

    expect(policy).toEqual({
      jurisdiction: "NONE",
      registered: false,
      rateBasisPoints: 1_000,
    });
    expect(includedTaxFromGross(32_000, policy)).toEqual({
      amountExTaxCents: 32_000,
      taxCents: 0,
      amountInclTaxCents: 32_000,
    });
  });

  it("keeps shared design details open while changing their market", () => {
    const pathname = "/designs/canvas-design-example-wedding-ed3f5c8d";

    expect(marketSwitchDestination(pathname, "AU")).toBe(pathname);
    expect(marketSwitchDestination(pathname, "NZ")).toBe(pathname);
  });

  it("extracts included Australian GST without changing the gross price", () => {
    const policy = marketTaxPolicy("AU", {
      registered: true,
      rateBasisPoints: 1_000,
    });

    expect(policy.jurisdiction).toBe("AU_GST");
    expect(includedTaxFromGross(33_000, policy)).toEqual({
      amountExTaxCents: 30_000,
      taxCents: 3_000,
      amountInclTaxCents: 33_000,
    });
  });

  it.each([-1, 1.2, Number.MAX_SAFE_INTEGER + 1])(
    "rejects unsafe gross cents %s",
    (amountInclTaxCents) => {
      expect(() => includedTaxFromGross(
        amountInclTaxCents,
        marketTaxPolicy("NZ"),
      )).toThrow("non-negative safe integer cents");
    },
  );
});
