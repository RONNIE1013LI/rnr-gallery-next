import { describe, expect, it } from "vitest";
import { cartQuantityChanges, mergeUserShoppingHistory } from "./user-shopping-history";
const item = { productKey: "photo-print-canvas", productTitle: "Photo Print Canvas", sizeLabel: "A4", peoplePets: 0, quantity: 1, unitPriceInclGstCents: 5000 };
describe("account shopping history", () => {
  it("does not invent additions from the first observed cart", () => {
    expect(cartQuantityChanges(null, [item])).toEqual([]);
  });
  it("reports additions, removals, and quantity changes between snapshots", () => {
    expect(cartQuantityChanges([], [item])).toEqual(["Added Photo Print Canvas (A4) × 1"]);
    expect(cartQuantityChanges([item], [])).toEqual(["Removed Photo Print Canvas (A4) × 1"]);
    expect(cartQuantityChanges([item], [{ ...item, quantity: 3 }])).toEqual(["Quantity changed: Photo Print Canvas (A4), 1 → 3"]);
  });
  it("aggregates equivalent configurations and ignores repricing as a quantity change", () => {
    expect(cartQuantityChanges([item, item], [{ ...item, quantity: 2, unitPriceInclGstCents: 4000 }])).toEqual([]);
  });
  it("sorts newest first with a stable tie break and explicitly signals truncation", () => {
    const events = Array.from({ length: 202 }, (_, i) => ({ id: String(i).padStart(4, "0"), kind: "pageview" as const, occurredAt: "2026-11-04T00:00:00.000Z", pathname: "/cart" }));
    const result = mergeUserShoppingHistory(events);
    expect(result.events).toHaveLength(200);
    expect(result.events[0].id).toBe("0201"); expect(result.hasMore).toBe(true);
    expect(mergeUserShoppingHistory([])).toEqual({ status: "available", events: [], hasMore: false });
  });
});
