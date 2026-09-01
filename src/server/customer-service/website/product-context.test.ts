import { describe, expect, it } from "vitest";
import { defaultProductRegistry, parseProductRegistry } from "@/domain/catalogue/product-registry";
import { resolveSafeProductContext } from "./product-context";

const registry = parseProductRegistry(defaultProductRegistry);

describe("Website safe product context", () => {
  it.each([
    ["/products/digital-oil-painting-canvas", "NZ", "product"],
    ["/products/digital-oil-painting-canvas/configure", "NZ", "configure"],
    ["/au/products/digital-oil-painting-canvas", "AU", "product"],
    ["/au/products/digital-oil-painting-canvas/configure", "AU", "configure"],
  ] as const)("resolves an allowlisted active product path: %s", (pathname, market, pageKind) => {
    expect(resolveSafeProductContext(pathname, registry)).toEqual({
      market,
      productKey: "digital-oil-painting-canvas",
      productTitle: "Digital Oil Painting Canvas",
      category: "canvas",
      pageKind,
    });
  });

  it.each([
    ["/custom-roll-up-banners-nz", "roll-up-banner", "Roll-Up Banner", "banners"],
    ["/custom-wall-banners-nz", "custom-themed-wall-banner", "Custom Themed Wall Banner", "banners"],
    ["/custom-photo-canvas-nz", "photo-print-canvas", "Photo Print Canvas", "canvas"],
  ] as const)("resolves an approved NZ advertising landing page: %s", (
    pathname,
    productKey,
    productTitle,
    category,
  ) => {
    expect(resolveSafeProductContext(pathname, registry)).toEqual({
      market: "NZ",
      productKey,
      productTitle,
      category,
      pageKind: "product",
    });
  });

  it.each([
    "https://rrgallery.co.nz/products/digital-oil-painting-canvas",
    "/products/digital-oil-painting-canvas?price=1",
    "/products/digital-oil-painting-canvas#order-1",
    "/product/digital-oil-painting-canvas",
    "/products/not-a-product",
    "/products/../account",
    "/products%2Fdigital-oil-painting-canvas",
    "/products\\digital-oil-painting-canvas",
  ])("rejects untrusted or unknown path data: %s", (pathname) => {
    expect(resolveSafeProductContext(pathname, registry)).toBeNull();
  });

  it("returns product identity only, without price or configuration", () => {
    const result = resolveSafeProductContext("/products/digital-oil-painting-canvas", registry);
    expect(Object.keys(result ?? {}).sort()).toEqual([
      "category",
      "market",
      "pageKind",
      "productKey",
      "productTitle",
    ]);
    expect(JSON.stringify(result)).not.toMatch(/price|shipping|availability|configuration|cart/i);
  });
});
