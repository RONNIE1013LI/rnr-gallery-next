import { describe, expect, it } from "vitest";
import {
  getProductBySlug,
  getProductsByCategory,
  products,
} from "./products";

describe("R&R catalogue", () => {
  it("contains the seven unique active products", () => {
    const activeProducts = products.filter((product) => product.active);
    const slugs = new Set(activeProducts.map((product) => product.slug));

    expect(activeProducts).toHaveLength(7);
    expect(slugs.size).toBe(7);
  });

  it.each([
    "photo-print-canvas",
    "digital-oil-painting-canvas",
    "custom-themed-canvas",
    "roll-up-banner",
    "custom-themed-wall-banner",
    "digital-oil-painting-banner",
    "grave-cover",
  ])("resolves %s", (slug) => {
    expect(getProductBySlug(slug)?.slug).toBe(slug);
  });

  it("uses local media and integer starting prices", () => {
    for (const product of products) {
      expect(product.image.src).toMatch(/^\/media\//);
      expect(product.image.alt.length).toBeGreaterThan(10);
      expect(product.startingPriceExGstCents).toBeGreaterThan(0);
      expect(Number.isInteger(product.startingPriceExGstCents)).toBe(true);
    }
  });

  it("groups three canvas and four banner products", () => {
    expect(getProductsByCategory("canvas")).toHaveLength(3);
    expect(getProductsByCategory("banners")).toHaveLength(4);
  });
});
