import { describe, expect, it } from "vitest";
import { InvalidPricingInputError } from "@/domain/pricing/types";
import { configurationSchemas, getConfigurationSchema } from "./schemas";
import { quoteConfiguration } from "./quote";

describe("configuration quotes", () => {
  it.each([
    ["photo-print-canvas", 6_500, 975, 7_475],
    ["digital-oil-painting-canvas", 10_500, 1_575, 12_075],
    ["custom-themed-canvas", 11_800, 1_770, 13_570],
    ["roll-up-banner", 23_000, 3_450, 26_450],
    ["custom-themed-wall-banner", 16_500, 2_475, 18_975],
    ["digital-oil-painting-banner", 16_000, 2_400, 18_400],
    ["grave-cover", 18_500, 2_775, 21_275],
  ])("quotes the valid default for %s", (productKey, subtotal, gst, total) => {
    const schema = getConfigurationSchema(productKey);
    expect(schema).toBeDefined();

    expect(
      quoteConfiguration(schema!, {
        sizeKey: schema!.defaultSizeKey,
        peoplePets: schema!.defaultPeoplePets,
      }),
    ).toMatchObject({
      subtotalExGstCents: subtotal,
      gstCents: gst,
      totalInclGstCents: total,
    });
  });

  it.each([
    [1, 10_500],
    [2, 12_500],
    [6, 22_000],
  ])("quotes Digital Oil A4 for %i people or pets", (peoplePets, subtotal) => {
    const schema = getConfigurationSchema("digital-oil-painting-canvas")!;
    expect(
      quoteConfiguration(schema, { sizeKey: "a4", peoplePets })
        .subtotalExGstCents,
    ).toBe(subtotal);
  });

  it("rejects an unavailable size", () => {
    expect(() =>
      quoteConfiguration(configurationSchemas[0], {
        sizeKey: "unknown",
        peoplePets: 0,
      }),
    ).toThrow(InvalidPricingInputError);
  });

  it("rejects a missing required people count", () => {
    const schema = getConfigurationSchema("digital-oil-painting-banner")!;
    expect(() =>
      quoteConfiguration(schema, { sizeKey: "160x80", peoplePets: 0 }),
    ).toThrow(InvalidPricingInputError);
  });

  it("adds a GST-inclusive urgent fee without taxing it twice", () => {
    const schema = getConfigurationSchema("digital-oil-painting-canvas")!;
    const quote = quoteConfiguration(schema, {
      sizeKey: "a4",
      peoplePets: 1,
      urgentFeeInclGstCents: 5_000,
    });

    expect(quote.lines.at(-1)).toEqual({
      key: "urgent-service",
      label: "Urgent service",
      amountExGstCents: 4_348,
      amountInclGstCents: 5_000,
    });
    expect(quote).toMatchObject({
      subtotalExGstCents: 14_848,
      gstCents: 2_227,
      totalInclGstCents: 17_075,
    });
  });

  it("derives Roll-Up extras from uploaded photo selections", () => {
    const schema = getConfigurationSchema("roll-up-banner")!;
    const quote = quoteConfiguration(schema, {
      sizeKey: "standard",
      peoplePets: 0,
      sourcePhotoCount: 7,
      extraBackgroundRemovalCount: 1,
    });

    expect(quote.lines).toEqual([
      { key: "product-size", label: "Product / size price", amountExGstCents: 23_000 },
      { key: "extra-photos", label: "Extra photos", amountExGstCents: 1_000 },
      {
        key: "extra-background-removals",
        label: "Extra background removals",
        amountExGstCents: 1_739,
        amountInclGstCents: 2_000,
      },
    ]);
    expect(quote.totalInclGstCents).toBe(29_600);
  });
});
