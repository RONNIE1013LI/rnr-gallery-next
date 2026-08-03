import { describe, expect, it } from "vitest";
import { calculateFixedPackage } from "@/domain/pricing/calculate-fixed-package";
import { createBrowserCartRepository } from "./browser-cart-repository";
import {
  addCartItem,
  calculateCartTotals,
  emptyCart,
  removeCartItem,
  setCartItemQuantity,
} from "./cart";
import type { CartItem, StorageLike } from "./types";

function item(overrides: Partial<CartItem> = {}): CartItem {
  return {
    id: "item-1",
    productKey: "photo-print-canvas",
    productSlug: "photo-print-canvas",
    productTitle: "Photo Print Canvas",
    imageSrc: "/media/home/family-canvas.webp",
    sizeKey: "a4",
    sizeLabel: "A4 — 29.7 × 21 cm",
    orientation: "landscape",
    peoplePets: 0,
    photoSubmissionMethod: "upload",
    designText: "",
    notes: "",
    neededDate: "2026-08-10",
    deliveryPreference: "post",
    quantity: 1,
    price: calculateFixedPackage({ priceExGstCents: 6_500 }),
    uploadReferences: [],
    ...overrides,
  };
}

class MemoryStorage implements StorageLike {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

describe("guest cart", () => {
  it("adds a new item and merges an existing item ID", () => {
    const once = addCartItem(emptyCart(), item());
    const twice = addCartItem(once, item({ quantity: 2 }));

    expect(twice.items).toHaveLength(1);
    expect(twice.items[0].quantity).toBe(3);
  });

  it("updates quantity and removes items immutably", () => {
    const original = addCartItem(emptyCart(), item());
    const updated = setCartItemQuantity(original, "item-1", 3);
    const removed = removeCartItem(updated, "item-1");

    expect(original.items[0].quantity).toBe(1);
    expect(updated.items[0].quantity).toBe(3);
    expect(removed.items).toHaveLength(0);
  });

  it("calculates multiplied subtotal, GST and total", () => {
    const cart = addCartItem(emptyCart(), item({ quantity: 2 }));
    expect(calculateCartTotals(cart)).toEqual({
      subtotalExGstCents: 13_000,
      gstCents: 1_950,
      totalInclGstCents: 14_950,
      itemCount: 2,
    });
  });

  it("round-trips through versioned storage", () => {
    const storage = new MemoryStorage();
    const repository = createBrowserCartRepository(storage);
    const cart = addCartItem(emptyCart(), item());

    repository.save(cart);
    expect(repository.load()).toEqual(cart);
    repository.clear();
    expect(repository.load()).toEqual(emptyCart());
  });

  it("keeps a valid gallery design ID and drops a malformed one without losing the cart", () => {
    const storage = new MemoryStorage();
    const repository = createBrowserCartRepository(storage);
    repository.save(addCartItem(emptyCart(), item({ galleryDesignId: "a".repeat(64) })));
    expect(repository.load().items[0].galleryDesignId).toBe("a".repeat(64));

    const malformed = JSON.parse(storage.getItem("rnr-cart-v1")!);
    malformed.items[0].galleryDesignId = "../../not-a-design";
    storage.setItem("rnr-cart-v1", JSON.stringify(malformed));

    expect(repository.load().items).toHaveLength(1);
    expect(repository.load().items[0]).not.toHaveProperty("galleryDesignId");
  });

  it.each(["not json", '{"version":2,"items":[]}', '{"version":1,"items":"bad"}'])(
    "fails closed for invalid stored data: %s",
    (value) => {
      const storage = new MemoryStorage();
      storage.setItem("rnr-cart-v1", value);
      expect(createBrowserCartRepository(storage).load()).toEqual(emptyCart());
    },
  );
});
