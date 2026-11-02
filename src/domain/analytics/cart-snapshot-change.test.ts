import { expect, it } from "vitest";
import { cartSnapshotChange } from "./cart-snapshot-change";
import type { ExplorerCartSnapshot } from "./website-analytics-explorer";
const first: ExplorerCartSnapshot = { id: "a", occurredAt: "2026-11-02T03:00:00Z", stage: "cart", currency: "NZD", totalInclGstCents: 10000, items: [{ productKey: "canvas", productTitle: "Canvas", sizeLabel: "A2", peoplePets: 2, quantity: 1, unitPriceInclGstCents: 10000 }] };
it("describes observed, empty, quantity, add/remove, checkout and market changes", () => {
  expect(cartSnapshotChange(null, first)).toBe("Cart observed");
  expect(cartSnapshotChange(first, { ...first, items: [], totalInclGstCents: 0 })).toBe("Cart emptied");
  expect(cartSnapshotChange(first, { ...first, items: [{ ...first.items[0]!, quantity: 2 }], totalInclGstCents: 20000 })).toBe("Quantity changed");
  expect(cartSnapshotChange(first, { ...first, items: [...first.items, { ...first.items[0]!, productKey: "banner" }] })).toBe("Item added");
  expect(cartSnapshotChange({ ...first, items: [...first.items, { ...first.items[0]!, productKey: "banner" }] }, first)).toBe("Item removed");
  expect(cartSnapshotChange(first, { ...first, stage: "checkout" })).toBe("Checkout cart observed");
  expect(cartSnapshotChange(first, { ...first, currency: "AUD" })).toBe("Market repriced");
});
