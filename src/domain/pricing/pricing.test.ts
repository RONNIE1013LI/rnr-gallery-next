import { describe, expect, it } from "vitest";
import { formatMarketMoney, formatNzd } from "@/domain/money";
import { calculateDigitalOilCanvas } from "./calculate-canvas";
import { calculateFixedPackage } from "./calculate-fixed-package";
import {
  getPriceLineAmountInclGstCents,
  InvalidPricingInputError,
} from "./types";

describe("R&R pricing", () => {
  it("calculates an A4 digital oil canvas with one person", () => {
    expect(
      calculateDigitalOilCanvas({ baseExGstCents: 6_500, peoplePets: 1 }),
    ).toMatchObject({
      subtotalExGstCents: 10_500,
      gstCents: 1_575,
      totalInclGstCents: 12_075,
    });
  });

  it("calculates an A4 digital oil canvas with two people", () => {
    expect(
      calculateDigitalOilCanvas({ baseExGstCents: 6_500, peoplePets: 2 }),
    ).toMatchObject({
      subtotalExGstCents: 12_500,
      gstCents: 1_875,
      totalInclGstCents: 14_375,
    });
  });

  it("uses the six-plus per-person rate for six people", () => {
    const price = calculateDigitalOilCanvas({
      baseExGstCents: 6_500,
      peoplePets: 6,
    });

    expect(price.lines).toContainEqual({
      key: "people-pets",
      label: "People / pets fee",
      amountExGstCents: 15_000,
    });
  });

  it("calculates the Roll-Up Banner fixed package", () => {
    expect(calculateFixedPackage({ priceExGstCents: 23_000 })).toMatchObject({
      subtotalExGstCents: 23_000,
      gstCents: 3_450,
      totalInclGstCents: 26_450,
    });
  });

  it("converts an excluded-GST price line to its customer-facing total", () => {
    expect(getPriceLineAmountInclGstCents({
      key: "product-size",
      label: "Product / size price",
      amountExGstCents: 23_000,
    })).toBe(26_450);
  });

  it("does not tax an already GST-inclusive fee again", () => {
    expect(getPriceLineAmountInclGstCents({
      key: "urgent-service",
      label: "Urgent service",
      amountExGstCents: 6_957,
      amountInclGstCents: 8_000,
    })).toBe(8_000);
  });

  it("rejects a canvas with no people or pets", () => {
    expect(() =>
      calculateDigitalOilCanvas({ baseExGstCents: 6_500, peoplePets: 0 }),
    ).toThrow(InvalidPricingInputError);
  });

  it("formats NZD cents consistently", () => {
    expect(formatNzd(12_075)).toBe("NZ$120.75");
  });

  it("formats each market currency explicitly", () => {
    expect(formatMarketMoney(12_075, "NZD")).toBe("NZ$120.75");
    expect(formatMarketMoney(32_000, "AUD")).toBe("A$320.00 AUD");
  });
});
