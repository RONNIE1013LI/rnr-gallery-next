import { describe, expect, it } from "vitest";
import {
  getProductBySlug,
  getProductsByCategory,
  products,
} from "./products";

describe("R&R catalogue", () => {
  it("contains the eight unique active products", () => {
    const activeProducts = products.filter((product) => product.active);
    const slugs = new Set(activeProducts.map((product) => product.slug));

    expect(activeProducts).toHaveLength(8);
    expect(slugs.size).toBe(8);
  });

  it.each([
    "photo-print-canvas",
    "digital-oil-painting-canvas",
    "custom-themed-canvas",
    "roll-up-banner",
    "banner-bundle",
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

  it("uses a distinct prepared shop image for every product", () => {
    expect(
      Object.fromEntries(products.map((product) => [product.key, product.image.src])),
    ).toEqual({
      "photo-print-canvas": "/media/products/photo-print-canvas-shop.webp",
      "digital-oil-painting-canvas": "/media/products/digital-oil-painting-canvas-shop.webp",
      "custom-themed-canvas": "/media/products/custom-themed-canvas-shop.webp",
      "roll-up-banner": "/media/products/roll-up-banner-shop.webp",
      "banner-bundle": "/media/products/banner-bundle.webp",
      "custom-themed-wall-banner": "/media/products/wall-hanging-banner-shop.webp",
      "digital-oil-painting-banner": "/media/products/digital-oil-painting-banner-shop.webp",
      "grave-cover": "/media/products/grave-cover-shop.webp",
    });

    expect(new Set(products.map((product) => product.image.src))).toHaveLength(8);
  });

  it("groups three canvas and five banner products", () => {
    expect(getProductsByCategory("canvas")).toHaveLength(3);
    expect(getProductsByCategory("banners")).toHaveLength(5);
  });

  it("exposes the Banner Bundle with its prepared product image", () => {
    expect(getProductBySlug("banner-bundle")).toMatchObject({
      category: "banners",
      workflowKey: "banner_bundle",
      image: { src: "/media/products/banner-bundle.webp" },
    });
  });

  it("states the finished dimensions in every single-size product summary", () => {
    expect(getProductBySlug("roll-up-banner")?.summary).toBe(
      "Our roll-up banner includes custom design, an 85 × 200 cm printed banner, stand, carry bag, pegs and box.",
    );
    expect(getProductBySlug("grave-cover")?.summary).toContain(
      "100 cm × 200 cm",
    );
  });
});
