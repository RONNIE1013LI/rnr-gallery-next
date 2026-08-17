import { describe, expect, it } from "vitest";
import { configurationSchemas } from "@/domain/configuration/schemas";
import { getPackageProfile, getPackageProfiles } from "./package-registry";

describe("shipping package registry", () => {
  it("covers every active product and size", () => {
    const resolved = configurationSchemas.flatMap((schema) =>
      schema.sizes.map((size) => ({
        productKey: schema.productKey,
        sizeKey: size.key,
        packageCount: getPackageProfiles(schema.productKey, size.key).length,
      })),
    );

    expect(resolved).toEqual(configurationSchemas.flatMap((schema) =>
      schema.sizes.map((size) => ({
        productKey: schema.productKey,
        sizeKey: size.key,
        packageCount: schema.productKey === "banner-bundle" ? 2 : 1,
      })),
    ));
  });

  it.each([
    ["rollup-wall-200x100", 1_040, 1_000],
    ["rollup-wall-300x150", 1_550, 3_000],
  ])("expands Bundle size %s into its Roll-Up and Wall Banner packages", (
    sizeKey,
    wallLengthMm,
    wallWeightGrams,
  ) => {
    expect(getPackageProfiles("banner-bundle", sizeKey)).toEqual([
      expect.objectContaining({ lengthMm: 900, weightGrams: 3_000 }),
      expect.objectContaining({ lengthMm: wallLengthMm, weightGrams: wallWeightGrams }),
    ]);
  });

  it.each([
    ["photo-print-canvas", "a4", 220, 300, 30, 500],
    ["digital-oil-painting-canvas", "a0", 1_200, 850, 30, 3_000],
    ["custom-themed-canvas", "a3", 300, 430, 30, 1_000],
    ["roll-up-banner", "standard", 900, 110, 110, 3_000],
    ["custom-themed-wall-banner", "160x80", 1_040, 60, 60, 1_000],
    ["digital-oil-painting-banner", "300x150", 1_550, 60, 60, 3_000],
    ["grave-cover", "standard", 1_040, 60, 60, 1_000],
  ])("resolves %s %s", (productKey, sizeKey, lengthMm, widthMm, heightMm, weightGrams) => {
    expect(getPackageProfile(productKey, sizeKey)).toEqual({
      productKey,
      sizeKey,
      lengthMm,
      widthMm,
      heightMm,
      weightGrams,
    });
  });

  it("fails closed for an unknown package", () => {
    expect(() => getPackageProfile("unknown", "a4")).toThrow("package profile");
  });
});
