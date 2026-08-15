import { describe, expect, it } from "vitest";
import { formatNzd } from "@/domain/money";
import { calculateDigitalOilCanvas } from "./calculate-canvas";
import { calculateFixedPackage } from "./calculate-fixed-package";
import { InvalidPricingInputError } from "./types";

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

  it("adds the per-person fee after the five-person package", () => {
    const price = calculateDigitalOilCanvas({
      baseExGstCents: 6_500,
      peoplePets: 6,
    });

    expect(price.lines).toContainEqual({
      key: "people-pets",
      label: "People / pets fee",
      amountExGstCents: 15_500,
    });
  });

  it("calculates the Roll-Up Banner fixed package", () => {
    expect(calculateFixedPackage({ priceExGstCents: 23_000 })).toMatchObject({
      subtotalExGstCents: 23_000,
      gstCents: 3_450,
      totalInclGstCents: 26_450,
    });
  });

  it("rejects a canvas with no people or pets", () => {
    expect(() =>
      calculateDigitalOilCanvas({ baseExGstCents: 6_500, peoplePets: 0 }),
    ).toThrow(InvalidPricingInputError);
  });

  it("formats NZD cents consistently", () => {
    expect(formatNzd(12_075)).toBe("$120.75");
  });
});
