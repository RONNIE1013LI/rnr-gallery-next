import { expect, it } from "vitest";
import { parseSupplyProductInput } from "./validation";

const fixture = {
  categoryId: "e895a51b-684f-442e-b83e-3334fb7c7600", title: "Synthetic item", slug: "synthetic", sku: "SYN", shortDescription: "", description: "", status: "published",
  priceCents: 1150, salePriceCents: null, weightGrams: 500, packedLengthMm: 100, packedWidthMm: 100, packedHeightMm: 100,
  trackInventory: true, stockQuantity: 3, available: true, pickupAllowed: true, shippingAllowed: true,
  seoTitle: "", seoDescription: "", sortOrder: 0, featured: false, variants: [],
};

it("accepts exact NZD minor units and rejects a promotion above retail", () => {
  expect(parseSupplyProductInput(fixture).priceCents).toBe(1150);
  expect(() => parseSupplyProductInput({ ...fixture, priceCents: 11.5 })).toThrow();
  expect(() => parseSupplyProductInput({ ...fixture, salePriceCents: 1200 })).toThrow();
});
it("requires explicit inventory count and a fulfilment method when published", () => {
  expect(() => parseSupplyProductInput({ ...fixture, stockQuantity: null })).toThrow();
  expect(() => parseSupplyProductInput({ ...fixture, pickupAllowed: false, shippingAllowed: false })).toThrow();
});
it("requires complete measured packaging for a shipping-enabled published product", () => {
  expect(() => parseSupplyProductInput({ ...fixture, weightGrams: null })).toThrow();
  expect(() => parseSupplyProductInput({ ...fixture, status: "draft", weightGrams: null })).not.toThrow();
});
it("rejects duplicate variant identities and duplicate SKUs", () => {
  const base = { id: "e895a51b-684f-442e-b83e-3334fb7c7601", sku: "SYN-L", label: "Long", options: { length: "Long" }, priceCents: 2300, salePriceCents: null, active: true, sortOrder: 0, weightGrams: 500, packedLengthMm: 100, packedWidthMm: 100, packedHeightMm: 100, trackInventory: true, stockQuantity: 3, available: true };
  expect(() => parseSupplyProductInput({ ...fixture, variants: [base, base] })).toThrow();
});
