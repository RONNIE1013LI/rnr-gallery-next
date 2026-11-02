import { describe, expect, it } from "vitest";
import type { Cart } from "@/domain/cart/types";
import { cartSnapshotPayload, cartSnapshotSchema } from "./cart-snapshot";

function cart(unit = 8900): Cart {
  return { version: 1, items: [{
    kind: "custom", id: "item-secret", productKey: "digital-oil-painting",
    productTitle: "Digital Oil Painting Canvas", productSlug: "digital-oil-painting-canvas",
    imageSrc: "https://private.example/photo-secret.jpg",
    sizeKey: "A2", sizeLabel: "A2", peoplePets: 5,
    photoSubmissionMethod: "upload", designText: "private personal message",
    notes: "personal address", neededDate: "2026-11-15",
    deliveryPreference: "post", quantity: 1,
    price: { currency: "AUD", market: "AU", lines: [], subtotalExGstCents: unit, gstCents: 0, totalInclGstCents: unit },
    uploadReferences: ["uploaded-private-image-id"],
  }]} as Cart;
}
describe("cart snapshot allowlist and money", () => {
  it("preserves customer-visible prices without submitting personal fields", () => {
    const snapshot = cartSnapshotPayload(cart());
    expect(snapshot).toEqual({
      version: 1, currency: "AUD", totalInclGstCents: 8900,
      items: [{ productKey: "digital-oil-painting", productTitle: "Digital Oil Painting Canvas",
        sizeLabel: "A2", peoplePets: 5, quantity: 1, unitPriceInclGstCents: 8900 }],
    });
    expect(JSON.stringify(snapshot)).not.toMatch(/secret|address|photo|message|upload|designText/i);
  });
  it("rejects client amount mismatches and surprise properties", () => {
    const payload = cartSnapshotPayload(cart())!;
    expect(cartSnapshotSchema.safeParse({
      ...payload, eventId: crypto.randomUUID(), stage: "cart", totalInclGstCents: 8901,
    }).success).toBe(false);
    expect(cartSnapshotSchema.safeParse({
      ...payload, eventId: crypto.randomUUID(), stage: "cart", customerEmail: "private@example.com",
    }).success).toBe(false);
  });
  it("keeps previous AUD currency when the final cart item is removed", () => {
    expect(cartSnapshotPayload({ version: 1, items: [] }, "AUD")).toEqual({
      version: 1, currency: "AUD", totalInclGstCents: 0, items: [],
    });
  });
});
