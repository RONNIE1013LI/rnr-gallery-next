import { afterEach, describe, expect, it } from "vitest";
import { calculateFixedPackage } from "@/domain/pricing/calculate-fixed-package";
import { cartToCheckoutInput } from "./checkout-input";
import { createBrowserCartRepository } from "./browser-cart-repository";
import { getCartStorageKey, setActiveCustomerId } from "./browser-cart-scope";
import type { Cart, CartItem, StorageLike } from "./types";

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const rollUpUploads = ["blob:roll-up-private-1.jpg", "blob:roll-up-private-2.jpg"];

function bundleItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    id: "bundle-item",
    productKey: "banner-bundle",
    productSlug: "banner-bundle",
    productTitle: "Banner Bundle",
    imageSrc: "/media/products/banner-bundle.png",
    sizeKey: "rollup-wall-200x100",
    sizeLabel: "85 × 200 cm Roll-Up + 200 × 100 cm Wall Banner",
    peoplePets: 0,
    photoSubmissionMethod: "upload",
    designText: "Private combined wording",
    notes: "Private combined notes",
    neededDate: "2026-08-20",
    deliveryPreference: "post",
    quantity: 1,
    price: calculateFixedPackage({ priceExGstCents: 29_999 }),
    uploadReferences: [...rollUpUploads],
    bundleComponents: [
      {
        componentKey: "roll-up",
        photoSubmissionMethod: "upload",
        designText: "Private Roll-Up wording",
        notes: "Private Roll-Up notes",
        uploadReferences: rollUpUploads,
        mainPhotoUploadId: rollUpUploads[0],
        extraBackgroundRemovalUploadIds: [rollUpUploads[1]],
      },
      {
        componentKey: "wall-banner",
        photoSubmissionMethod: "later",
        designText: "Private Wall Banner wording",
        notes: "Private Wall Banner notes",
        uploadReferences: [],
      },
    ],
    ...overrides,
  };
}

function regularItem(): CartItem {
  return {
    ...bundleItem(),
    id: "regular-item",
    productKey: "photo-print-canvas",
    productSlug: "photo-print-canvas",
    productTitle: "Photo Print Canvas",
    sizeKey: "a4",
    sizeLabel: "A4",
    photoSubmissionMethod: "later",
    designText: "",
    notes: "",
    uploadReferences: [],
    bundleComponents: undefined,
  };
}

describe("browser Cart repository Banner Bundle persistence", () => {
  afterEach(() => setActiveCustomerId(null));

  it("round-trips and freezes both component groups and checkout copies", () => {
    const storage = new MemoryStorage();
    const repository = createBrowserCartRepository(storage, getCartStorageKey("customer-a"));
    const cart: Cart = { version: 1, items: [bundleItem()] };

    repository.save(cart);
    const loaded = repository.load();
    const components = loaded.items[0].bundleComponents!;

    expect(components.map((component) => component.photoSubmissionMethod)).toEqual([
      "upload",
      "later",
    ]);
    expect(components[0].uploadReferences).toEqual(rollUpUploads);
    expect(components[1].uploadReferences).toEqual([]);
    expect(Object.isFrozen(components)).toBe(true);
    expect(Object.isFrozen(components[0])).toBe(true);
    expect(Object.isFrozen(components[0].uploadReferences)).toBe(true);
    expect(Object.isFrozen(components[0].extraBackgroundRemovalUploadIds)).toBe(true);

    const checkout = cartToCheckoutInput(loaded);
    expect(checkout.items[0].bundleComponents).toEqual(components);
    expect(checkout.items[0].bundleComponents).not.toBe(components);
    expect(Object.isFrozen(checkout.items[0].bundleComponents)).toBe(true);
    expect(Object.isFrozen(
      checkout.items[0].bundleComponents?.[0].uploadReferences,
    )).toBe(true);
  });

  it("rejects only an invalid partial Bundle item in its own identity namespace", () => {
    const storage = new MemoryStorage();
    const customerAKey = getCartStorageKey("customer-a");
    const customerBKey = getCartStorageKey("customer-b");
    const customerB = createBrowserCartRepository(storage, customerBKey);
    customerB.save({ version: 1, items: [bundleItem({ id: "bundle-b" })] });
    const customerBRaw = storage.getItem(customerBKey);
    const customerA = createBrowserCartRepository(storage, customerAKey);
    const partialBundle = bundleItem({
      id: "partial-bundle",
      bundleComponents: [bundleItem().bundleComponents![0]],
    });

    customerA.save({ version: 1, items: [regularItem(), partialBundle] });

    expect(customerA.load().items.map((item) => item.id)).toEqual(["regular-item"]);
    expect(storage.getItem(customerBKey)).toBe(customerBRaw);
    expect(customerB.load().items.map((item) => item.id)).toEqual(["bundle-b"]);
  });
});
