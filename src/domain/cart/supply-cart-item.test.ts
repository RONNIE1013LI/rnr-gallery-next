import { describe, expect, it } from "vitest";
import { createSupplyCartItem } from "./supply-cart-item";
import { parseStoredCart } from "./browser-cart-repository";
import { cartToCheckoutInput } from "./checkout-input";
import { calculateCartTotals, setCartItemQuantity } from "./cart";

const selection = { id: "00000000-0000-4000-8000-000000000001", productId: "00000000-0000-4000-8000-000000000002", title: "Synthetic supply", slug: "synthetic", sku: "TEST", imageSrc: "/synthetic.png", unitPriceCents: 1150, quantity: 12 };
describe("standard supplies browser cart", () => {
  it("roundtrips standard selections and sends only IDs and quantity to checkout", () => {
    const item = createSupplyCartItem(selection);
    const cart = parseStoredCart(JSON.stringify({ version: 1, items: [item] }));
    expect(cart.items[0]).toEqual(item);
    expect(cartToCheckoutInput(cart).items[0]).toEqual({ kind: "supply", clientItemId: selection.id, supplyProductId: selection.productId, quantity: 12 });
    expect(cart.items[0]).not.toHaveProperty("neededDate");
    expect(calculateCartTotals(cart)).toEqual({ subtotalExGstCents: 12000, gstCents: 1800, totalInclGstCents: 13800, itemCount: 12 });
    expect(setCartItemQuantity(cart, selection.id, 24).items[0].quantity).toBe(24);
  });
  it("drops injected artwork metadata from a stored supply selection", () => {
    const cart = parseStoredCart(JSON.stringify({ version: 1, items: [{ ...createSupplyCartItem(selection), neededDate: "2026-11-20", uploadReferences: ["private"] }] }));
    expect(cart.items[0]).not.toHaveProperty("uploadReferences");
    expect(cart.items[0]).not.toHaveProperty("neededDate");
  });
});
