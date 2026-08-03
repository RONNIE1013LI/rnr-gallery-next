import { describe, expect, it } from "vitest";
import {
  parseGalleryManifest,
  productSlugForTarget,
} from "./manifest";

const validRecord = {
  id: "a".repeat(64),
  product_type: "Canvas",
  product_type_slug: "canvas",
  occasion: "Memorial",
  occasion_slug: "memorial",
  sub_occasion: "",
  theme: "Cultural / Island",
  theme_slugs: ["cultural-island"],
  file: "canvas/rnr-canvas-example.jpg",
  alt: "Canvas design example – Memorial",
  target: "/product/digital-oil-painting-canvas/",
};

describe("parseGalleryManifest", () => {
  it("normalizes a reviewed record and converts its approved product target", () => {
    expect(parseGalleryManifest([validRecord])).toEqual([
      {
        id: "a".repeat(64),
        productTypeSlug: "canvas",
        occasionSlug: "memorial",
        subOccasion: null,
        themeSlugs: ["cultural-island"],
        sourceFile: "canvas/rnr-canvas-example.jpg",
        altText: "Canvas design example – Memorial",
        productSlug: "digital-oil-painting-canvas",
      },
    ]);
  });

  it("rejects an unapproved product destination", () => {
    expect(() =>
      parseGalleryManifest([{ ...validRecord, target: "/product/unknown/" }]),
    ).toThrow(/unapproved product target/i);
  });

  it("rejects a target that is approved for a different product type", () => {
    expect(() =>
      parseGalleryManifest([
        { ...validRecord, target: "/product/roll-up-banner/" },
      ]),
    ).toThrow(/not allowed for canvas/i);
  });

  it("rejects traversal and paths outside the product directory", () => {
    expect(() =>
      parseGalleryManifest([{ ...validRecord, file: "../secret.jpg" }]),
    ).toThrow(/invalid gallery file path/i);
    expect(() =>
      parseGalleryManifest([
        { ...validRecord, file: "grave-cover/example.jpg" },
      ]),
    ).toThrow(/must be inside canvas/i);
  });

  it("rejects duplicate IDs and source paths", () => {
    expect(() => parseGalleryManifest([validRecord, validRecord])).toThrow(
      /duplicate gallery id/i,
    );

    expect(() =>
      parseGalleryManifest([
        validRecord,
        { ...validRecord, id: "b".repeat(64) },
      ]),
    ).toThrow(/duplicate gallery source file/i);
  });

  it("rejects unknown categories and duplicate themes", () => {
    expect(() =>
      parseGalleryManifest([
        { ...validRecord, occasion_slug: "other", occasion: "Other" },
      ]),
    ).toThrow(/invalid occasion/i);
    expect(() =>
      parseGalleryManifest([
        {
          ...validRecord,
          theme_slugs: ["cultural-island", "cultural-island"],
        },
      ]),
    ).toThrow(/duplicate gallery theme/i);
  });

  it("rejects malformed IDs, empty alt text, and unsupported file formats", () => {
    expect(() =>
      parseGalleryManifest([{ ...validRecord, id: "short" }]),
    ).toThrow(/invalid gallery id/i);
    expect(() =>
      parseGalleryManifest([{ ...validRecord, alt: "  " }]),
    ).toThrow(/alt text is required/i);
    expect(() =>
      parseGalleryManifest([
        { ...validRecord, file: "canvas/example.svg" },
      ]),
    ).toThrow(/invalid gallery file path/i);
  });
});

describe("productSlugForTarget", () => {
  it.each([
    [
      "/product/digital-oil-painting-canvas/",
      "digital-oil-painting-canvas",
    ],
    ["/product/custom-themed-canvas/", "custom-themed-canvas"],
    ["/product/grave-cover/", "grave-cover"],
    ["/product/roll-up-banner/", "roll-up-banner"],
    [
      "/product/custom-themed-wall-banner/",
      "custom-themed-wall-banner",
    ],
  ])("maps %s to %s", (target, expected) => {
    expect(productSlugForTarget(target)).toBe(expected);
  });
});
