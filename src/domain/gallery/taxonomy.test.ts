import { expect, it } from "vitest";
import { galleryDesignTypeForProduct } from "./taxonomy";
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
