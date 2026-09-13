import { describe, expect, it } from "vitest";
import { calculateFixedPackage } from "@/domain/pricing/calculate-fixed-package";
import { createBrowserCartRepository } from "./browser-cart-repository";
import {
  addCartItem,
  calculateCartTotals,
  emptyCart,
  removeCartItem,
  setCartItemQuantity,
  applyAuthoritativeRepricing,
  cartMatchesMarket,
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

  it("replaces every browser price from one authoritative market snapshot", () => {
    const original = addCartItem(emptyCart(), item({ deliveryPreference: "pickup" }));
    const unitPrice = {
      market: "AU" as const, currency: "AUD" as const, taxJurisdiction: "NONE" as const,
      taxRateBasisPoints: 1_000, discountCents: 0, designSurchargeCents: 0,
      lines: [], subtotalExGstCents: 40_000, gstCents: 0, totalInclGstCents: 40_000,
    };
    const updated = applyAuthoritativeRepricing(original, {
      version: 1, market: "AU", currency: "AUD", taxJurisdiction: "NONE",
      taxRateBasisPoints: 1_000, priceBookRevision: 9, orderDate: "2026-08-16",
      items: [{
        clientItemId: "item-1", productKey: "photo-print-canvas",
        productSlug: "photo-print-canvas", productTitle: "Photo Print Canvas",
        sizeKey: "a4", sizeLabel: "A4", orientation: "landscape", peoplePets: 0,
        photoSubmissionMethod: "upload", designText: "", notes: "", neededDate: "2026-08-10",
        urgentServiceConfirmed: false, urgentService: { workingDays: 5, feeInclGstCents: 0 },
        quantity: 1, uploadReferences: [], unitPrice,
        lineSubtotalExGstCents: 40_000, lineGstCents: 0, lineTotalInclGstCents: 40_000,
      }],
      subtotalExGstCents: 40_000, gstCents: 0, totalInclGstCents: 40_000,
      discountCents: 0, designSurchargeCents: 0, itemCount: 1, cartDigest: "a".repeat(64),
    });

    expect(updated.items[0]).toMatchObject({
      deliveryPreference: "post",
      price: { market: "AU", currency: "AUD", totalInclGstCents: 40_000 },
    });
  });

  it("detects whether every stored item belongs to the active market", () => {
    const nzCart = addCartItem(emptyCart(), item());
    const auCart = addCartItem(emptyCart(), item({
      price: {
        market: "AU",
        currency: "AUD",
        taxJurisdiction: "NONE",
        taxRateBasisPoints: 1_000,
        discountCents: 0,
        designSurchargeCents: 0,
        lines: [],
        subtotalExGstCents: 40_000,
        gstCents: 0,
        totalInclGstCents: 40_000,
      },
    }));

    expect(cartMatchesMarket(nzCart, "NZ")).toBe(true);
    expect(cartMatchesMarket(nzCart, "AU")).toBe(false);
    expect(cartMatchesMarket(auCart, "AU")).toBe(true);
    expect(cartMatchesMarket(auCart, "NZ")).toBe(false);
    expect(cartMatchesMarket(emptyCart(), "AU")).toBe(true);
  });

  it("keeps a valid gallery design ID and drops a malformed one without losing the cart", () => {
    const storage = new MemoryStorage();
    const repository = createBrowserCartRepository(storage);
    repository.save(addCartItem(emptyCart(), item({ galleryDesignId: "a".repeat(64) })));
    expect(repository.load().items[0].galleryDesignId).toBe("a".repeat(64));

    const malformed = JSON.parse(storage.getItem("rnr:commerce:v1:guest:cart")!);
    malformed.items[0].galleryDesignId = "../../not-a-design";
    storage.setItem("rnr:commerce:v1:guest:cart", JSON.stringify(malformed));

    expect(repository.load().items).toHaveLength(1);
    expect(repository.load().items[0]).not.toHaveProperty("galleryDesignId");
  });

  it("migrates legacy Grave Cover carts to the canonical format without orientation", () => {
    const storage = new MemoryStorage();
    const repository = createBrowserCartRepository(storage);
    repository.save(addCartItem(emptyCart(), item({
      productKey: "grave-cover",
      productSlug: "grave-cover",
      productTitle: "Grave Cover",
      sizeKey: "standard",
      sizeLabel: "200 × 100 cm",
      orientation: "portrait",
    })));

    const [storedItem] = repository.load().items;
    expect(storedItem.sizeLabel).toBe("100 × 200 cm");
    expect(storedItem).not.toHaveProperty("orientation");
  });

  it.each(["not json", '{"version":2,"items":[]}', '{"version":1,"items":"bad"}'])(
    "fails closed for invalid stored data: %s",
    (value) => {
      const storage = new MemoryStorage();
      storage.setItem("rnr:commerce:v1:guest:cart", value);
      expect(createBrowserCartRepository(storage).load()).toEqual(emptyCart());
    },
  );
});
