import { expect, it } from "vitest";
import { galleryDesignTypeForProduct, galleryProductTypes, galleryTargetProducts } from "./taxonomy";
import { parseGalleryQuery } from "./query";

it.each([
  ["digital-oil-painting-banner", "wall-hanging-banners"],
  ["custom-themed-wall-banner", "wall-hanging-banners"],
  ["roll-up-banner", "roll-up-banner"],
  ["grave-cover", "grave-cover"],
  ["digital-oil-painting-canvas", "canvas"],
  ["custom-themed-canvas", "canvas"],
  ["photo-print-canvas", "canvas"],
])("maps %s to the Gallery family filter", (slug, designType) => {
  expect(galleryDesignTypeForProduct(slug)).toBe(designType);
  expect(parseGalleryQuery({ design_type: galleryDesignTypeForProduct(slug) }).productTypes).toEqual([designType]);
});
it("does not invent a Gallery type for unknown products", () => {
  expect(galleryDesignTypeForProduct("unknown-product")).toBeUndefined();
});

it("keeps all three canvas products available as gallery targets", () => {
  expect(galleryProductTypes.canvas).toEqual([
    "photo-print-canvas",
    "digital-oil-painting-canvas",
    "custom-themed-canvas",
  ]);
  expect(galleryTargetProducts["/product/photo-print-canvas/"]).toBe("photo-print-canvas");
});
