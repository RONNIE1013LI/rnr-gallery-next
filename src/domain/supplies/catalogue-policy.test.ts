import { describe, expect, it } from "vitest";
import { publicSuppliesCatalogue, validateSupplyPurchase } from "./catalogue-policy";
import type { SuppliesCatalogue, SupplyProduct } from "./types";

const packaging = { weightGrams: 500, packedLengthMm: 600, packedWidthMm: 100, packedHeightMm: 100 };
const product: SupplyProduct = {
  id: "product-1", categoryId: "category-1", title: "Synthetic stand", slug: "synthetic-stand", sku: "SYN-1",
  shortDescription: "Stand Only — No Printed Banner Included", description: "Fixture", status: "published",
  priceCents: 1150, salePriceCents: 1000, trackInventory: true, stockQuantity: 3, available: true,
  ...packaging, pickupAllowed: true, shippingAllowed: true, seoTitle: "", seoDescription: "", sortOrder: 0, featured: false,
  variants: [], images: [],
};
const catalogue: SuppliesCatalogue = {
  settings: { enabled: true, updatedAt: null, updatedBy: null },
  categories: [{ id: "category-1", name: "Synthetic supplies", slug: "synthetic", description: "", sortOrder: 0, visible: true, archived: false, image: null }],
  products: [product],
};

describe("supplies server visibility and purchase authority", () => {
  it("fails closed when the store is OFF", () => {
    expect(publicSuppliesCatalogue({ ...catalogue, settings: { ...catalogue.settings, enabled: false } })).toBeNull();
  });
  it("omits drafts, hidden categories and archived products", () => {
    const filtered = publicSuppliesCatalogue({ ...catalogue, products: [product, { ...product, id: "draft", status: "draft" }] });
    expect(filtered?.products.map((item) => item.id)).toEqual(["product-1"]);
    expect(publicSuppliesCatalogue({ ...catalogue, categories: [{ ...catalogue.categories[0], visible: false }] })?.products).toEqual([]);
  });
  it("does not disclose administrator identity or switch audit details publicly", () => {
    expect(publicSuppliesCatalogue({ ...catalogue, settings: { enabled: true, updatedAt: "synthetic-date", updatedBy: "synthetic-admin" } })?.settings).toEqual({ enabled: true, updatedAt: null, updatedBy: null });
  });
  it("resolves price, inventory and packaging from the authoritative selection", () => {
    expect(validateSupplyPurchase(catalogue, product.id)).toMatchObject({ unitPriceCents: 1000, stockQuantity: 3, ...packaging });
  });
  it("rejects unknown or inactive variant and requires selection when variants exist", () => {
    const variant = { ...packaging, id: "variant-1", productId: product.id, sku: "SYN-L", label: "Long", options: { length: "Long" }, priceCents: 2300, salePriceCents: null, active: true, trackInventory: true, stockQuantity: 1, available: true, sortOrder: 0 };
    const varied = { ...catalogue, products: [{ ...product, variants: [variant] }] };
    expect(validateSupplyPurchase(varied, product.id)).toBeNull();
    expect(validateSupplyPurchase(varied, product.id, "unknown")).toBeNull();
    expect(validateSupplyPurchase(varied, product.id, variant.id)?.unitPriceCents).toBe(2300);
    expect(validateSupplyPurchase({ ...varied, products: [{ ...product, variants: [{ ...variant, active: false }] }] }, product.id, variant.id)).toBeNull();
    expect(publicSuppliesCatalogue({ ...varied, products: [{ ...product, variants: [{ ...variant, active: false }] }] })?.products[0].available).toBe(false);
  });
  it("blocks stock exhaustion and OFF purchases", () => {
    expect(validateSupplyPurchase({ ...catalogue, products: [{ ...product, stockQuantity: 0 }] }, product.id)).toBeNull();
    expect(validateSupplyPurchase({ ...catalogue, settings: { ...catalogue.settings, enabled: false } }, product.id)).toBeNull();
  });
  it("reserved-stock authority bypasses only the depleted balance", () => {
    const depleted = { ...catalogue, products: [{ ...product, stockQuantity: 0 }] };
    expect(validateSupplyPurchase(depleted, product.id, null, { allowReservedStock: true })?.unitPriceCents).toBe(1000);
    expect(validateSupplyPurchase({ ...depleted, products: [{ ...product, stockQuantity: 0, available: false }] }, product.id, null, { allowReservedStock: true })).toBeNull();
    expect(validateSupplyPurchase({ ...depleted, settings: { ...catalogue.settings, enabled: false } }, product.id, null, { allowReservedStock: true })).toBeNull();
  });
  it("a removed variant preserves its identity without blocking conversion to a simple product", () => {
    const variant = { ...packaging, id: "removed-variant", productId: product.id, sku: "SYN-REMOVED", label: "Removed", options: {}, priceCents: 2300, salePriceCents: null, active: false, archived: true, trackInventory: true, stockQuantity: 1, available: false, sortOrder: 0 };
    const converted = { ...catalogue, products: [{ ...product, variants: [variant] }] };
    expect(publicSuppliesCatalogue(converted)?.products[0]).toMatchObject({ available: true, variants: [] });
    expect(validateSupplyPurchase(converted, product.id)).toMatchObject({ unitPriceCents: 1000, variant: null });
    expect(validateSupplyPurchase(converted, product.id, variant.id)).toBeNull();
  });
});
