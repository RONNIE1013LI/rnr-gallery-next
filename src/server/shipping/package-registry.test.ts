import { describe, expect, it } from "vitest";
import { configurationSchemas } from "@/domain/configuration/schemas";
import { getPackageProfile, packageProfiles } from "./package-registry";

describe("shipping package registry", () => {
  it("covers every active product and size", () => {
    const expected = configurationSchemas.flatMap((schema) =>
      schema.sizes.map((size) => `${schema.productKey}:${size.key}`),
    );

    expect(packageProfiles.map((profile) => `${profile.productKey}:${profile.sizeKey}`).sort())
      .toEqual(expected.sort());
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
