import { describe, expect, it } from "vitest";
import { parseCheckoutCartInput } from "./input-schema";
import { repriceCart } from "./reprice-cart";

const id = "00000000-0000-4000-8000-000000000001";
const productId = "00000000-0000-4000-8000-000000000002";
const selection = { kind: "supply", clientItemId: id, supplyProductId: productId, quantity: 12 };
const supply = { productId, variantId: null, title: "Synthetic stand", slug: "synthetic-stand", sku: "TEST-STAND", variantLabel: "Standard", unitPriceCents: 1150, trackInventory: true, stockQuantity: 20, weightGrams: 1100, packedLengthMm: 910, packedWidthMm: 130, packedHeightMm: 125, pickupAllowed: true, shippingAllowed: true };

describe("standard supply checkout boundary", () => {
  it("accepts supply selection without custom artwork fields and strips browser prices", () => {
    expect(parseCheckoutCartInput({ version: 1, items: [{ ...selection, price: 1 }] }).items[0]).toEqual(selection);
  });
  it("uses server supply price and measured shipping snapshot with NZ GST", () => {
    const result = repriceCart({ version: 1, items: [{ ...selection, unitPriceCents: 1 }] }, { supplies: new Map([[productId, supply]]) });
    expect(result.items[0]).toMatchObject({ kind: "supply", quantity: 12, unitPrice: { totalInclGstCents: 1150, subtotalExGstCents: 1000, gstCents: 150 }, lineTotalInclGstCents: 13800, supplySnapshot: { sku: "TEST-STAND", weightGrams: 1100 } });
    expect(result.items[0]).not.toHaveProperty("neededDate");
    expect(result.items[0]).not.toHaveProperty("photoSubmissionMethod");
  });
  it("rejects missing/unpublished/off-store supply authorities", () => {
    expect(() => repriceCart({ version: 1, items: [selection] })).toThrow();
  });
  it("blocks supplies in Australia even when a price authority is supplied", () => {
    expect(() => repriceCart({ version: 1, items: [selection] }, { market: "AU", supplies: new Map([[productId, supply]]) })).toThrow(/New Zealand/);
  });
  it("aggregates duplicate supply selections before checking available stock", () => {
    expect(() => repriceCart({ version: 1, items: [selection, { ...selection, clientItemId: "00000000-0000-4000-8000-000000000003" }] }, { supplies: new Map([[productId, supply]]) })).toThrow(/stock/);
  });
  it("rejects over-stock quantity and keeps custom item maximum at five", () => {
    expect(() => repriceCart({ version: 1, items: [{ ...selection, quantity: 21 }] }, { supplies: new Map([[productId, supply]]) })).toThrow(/stock/);
    expect(() => parseCheckoutCartInput({ version: 1, items: [{ clientItemId: id, productKey: "photo-print-canvas", sizeKey: "a4", peoplePets: 0, photoSubmissionMethod: "later", designText: "", notes: "", neededDate: "2026-11-20", quantity: 6, uploadReferences: [] }] })).toThrow();
  });
});
