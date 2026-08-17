import type { PackageProfile } from "./types";

const canvasProfiles = Object.freeze({
  a4: Object.freeze({ lengthMm: 220, widthMm: 300, heightMm: 30, weightGrams: 500 }),
  a3: Object.freeze({ lengthMm: 300, widthMm: 430, heightMm: 30, weightGrams: 1_000 }),
  a2: Object.freeze({ lengthMm: 430, widthMm: 600, heightMm: 30, weightGrams: 1_000 }),
  a1: Object.freeze({ lengthMm: 600, widthMm: 850, heightMm: 30, weightGrams: 2_000 }),
  a0: Object.freeze({ lengthMm: 1_200, widthMm: 850, heightMm: 30, weightGrams: 3_000 }),
});

function canvasProductProfiles(
  productKey: string,
  sizeKeys: readonly (keyof typeof canvasProfiles)[],
): readonly PackageProfile[] {
  return sizeKeys.map((sizeKey) => Object.freeze({
    productKey,
    sizeKey,
    ...canvasProfiles[sizeKey],
  }));
}

function bannerProfiles(productKey: string): readonly PackageProfile[] {
  return [
    Object.freeze({
      productKey,
      sizeKey: "160x80",
      lengthMm: 1_040,
      widthMm: 60,
      heightMm: 60,
      weightGrams: 1_000,
    }),
    Object.freeze({
      productKey,
      sizeKey: "200x100",
      lengthMm: 1_040,
      widthMm: 60,
      heightMm: 60,
      weightGrams: 1_000,
    }),
    Object.freeze({
      productKey,
      sizeKey: "300x150",
      lengthMm: 1_550,
      widthMm: 60,
      heightMm: 60,
      weightGrams: 3_000,
    }),
  ];
}

export const packageProfiles: readonly PackageProfile[] = Object.freeze([
  ...canvasProductProfiles("photo-print-canvas", ["a4", "a3", "a2", "a1", "a0"]),
  ...canvasProductProfiles("digital-oil-painting-canvas", ["a4", "a3", "a2", "a1", "a0"]),
  ...canvasProductProfiles("custom-themed-canvas", ["a3", "a2", "a1", "a0"]),
  Object.freeze({
    productKey: "roll-up-banner",
    sizeKey: "standard",
    lengthMm: 900,
    widthMm: 110,
    heightMm: 110,
    weightGrams: 3_000,
  }),
  ...bannerProfiles("custom-themed-wall-banner"),
  ...bannerProfiles("digital-oil-painting-banner"),
  Object.freeze({
    productKey: "grave-cover",
    sizeKey: "standard",
    lengthMm: 1_040,
    widthMm: 60,
    heightMm: 60,
    weightGrams: 1_000,
  }),
]);

export function getPackageProfile(productKey: string, sizeKey: string): PackageProfile {
  const profile = packageProfiles.find(
    (candidate) => candidate.productKey === productKey && candidate.sizeKey === sizeKey,
  );
  if (!profile) {
    throw new Error(`No shipping package profile exists for ${productKey}:${sizeKey}.`);
  }
  return profile;
}

const bannerBundleWallSizeKeys = Object.freeze({
  "rollup-wall-200x100": "200x100",
  "rollup-wall-300x150": "300x150",
} satisfies Readonly<Record<string, string>>);

export function getPackageProfiles(
  productKey: string,
  sizeKey: string,
): readonly PackageProfile[] {
  if (productKey !== "banner-bundle") {
    return Object.freeze([getPackageProfile(productKey, sizeKey)]);
  }

  const wallSizeKey = bannerBundleWallSizeKeys[
    sizeKey as keyof typeof bannerBundleWallSizeKeys
  ];
  if (!wallSizeKey) {
    throw new Error(`No shipping package profile exists for ${productKey}:${sizeKey}.`);
  }
  return Object.freeze([
    getPackageProfile("roll-up-banner", "standard"),
    getPackageProfile("custom-themed-wall-banner", wallSizeKey),
  ]);
}
