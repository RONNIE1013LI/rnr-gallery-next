import { afterEach, describe, expect, it } from "vitest";

import { createBrowserCartRepository } from "./browser-cart-repository";
import {
  getCartStorageKey,
  getCheckoutDraftStorageKey,
  getCheckoutIntentCartBackupKey,
  getPaymentIntentStorageKey,
  getPendingCheckoutStorageKey,
  setActiveCustomerId,
} from "./browser-cart-scope";
import type { Cart, StorageLike } from "./types";

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

function cart(productTitle: string): Cart {
  return { version: 1, items: [{
    id: productTitle, productKey: "photo-print-canvas", productSlug: "photo-print-canvas",
    productTitle, imageSrc: "/test.jpg", sizeKey: "a4", sizeLabel: "A4", peoplePets: 0,
    photoSubmissionMethod: "later", designText: "", notes: "", neededDate: "2026-08-20",
    deliveryPreference: "pickup", quantity: 1,
    price: { lines: [], subtotalExGstCents: 6500, gstCents: 975, totalInclGstCents: 7475 },
    uploadReferences: [],
  }] };
}

describe("same-browser commerce identity isolation", () => {
  afterEach(() => setActiveCustomerId(null));
  it("uses distinct Cart, checkout draft, pending checkout, and payment recovery keys", () => {
    for (const keyFor of [getCartStorageKey, getPendingCheckoutStorageKey,
      getPaymentIntentStorageKey, getCheckoutDraftStorageKey, getCheckoutIntentCartBackupKey]) {
      expect(keyFor(null)).not.toBe(keyFor("customer-a"));
      expect(keyFor("customer-a")).not.toBe(keyFor("customer-b"));
    }
  });

  it("keeps Guest, User A, and User B carts isolated without guest merge", () => {
    const storage = new MemoryStorage();
    const guest = createBrowserCartRepository(storage, getCartStorageKey(null));
    const userA = createBrowserCartRepository(storage, getCartStorageKey("customer-a"));
    const userB = createBrowserCartRepository(storage, getCartStorageKey("customer-b"));
    expect(guest.load().items).toEqual([]);
    userA.save(cart("Product A"));
    expect(guest.load().items).toEqual([]);
    expect(userB.load().items).toEqual([]);
    userB.save(cart("Product B"));
    expect(userB.load().items.map((item) => item.productTitle)).toEqual(["Product B"]);
    expect(userA.load().items.map((item) => item.productTitle)).toEqual(["Product A"]);
    guest.save(cart("Guest Product"));
    expect(userA.load().items.map((item) => item.productTitle)).toEqual(["Product A"]);
    expect(guest.load().items.map((item) => item.productTitle)).toEqual(["Guest Product"]);
  });

  it("keeps checkout drafts, pending orders, and payment recovery isolated", () => {
    const storage = new MemoryStorage();
    const customerA = "customer-a";
    const customerB = "customer-b";
    for (const keyFor of [getPendingCheckoutStorageKey, getPaymentIntentStorageKey,
      getCheckoutDraftStorageKey, getCheckoutIntentCartBackupKey]) {
      storage.setItem(keyFor(customerA), "A private checkout state");
      expect(storage.getItem(keyFor(customerB))).toBeNull();
      expect(storage.getItem(keyFor(null))).toBeNull();
    }
  });
});
