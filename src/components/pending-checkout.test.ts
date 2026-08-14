import { beforeEach, describe, expect, it } from "vitest";
import { CART_STORAGE_KEY, type Cart } from "@/domain/cart/types";
import type {
  CheckoutStartingPaymentIntent,
  PlacingOrderIntent,
} from "./payment-recovery-intent";
import {
  PENDING_CHECKOUT_STORAGE_KEY,
  clearPendingCheckout,
  completePendingCheckout,
  pendingCheckoutMatchesCart,
  readPendingCheckout,
  savePendingCheckout,
} from "./pending-checkout";

const cart: Cart = { version: 1, items: [{
  id: "30000000-0000-4000-8000-000000000001",
  productKey: "photo-print-canvas",
  productSlug: "photo-print-canvas",
  productTitle: "Photo Print Canvas",
  imageSrc: "/test.jpg",
  sizeKey: "a4",
  sizeLabel: "A4",
  orientation: "landscape",
  peoplePets: 0,
  photoSubmissionMethod: "later",
  designText: "Family",
  notes: "",
  neededDate: "2026-08-20",
  urgentServiceConfirmed: false,
  deliveryPreference: "pickup",
  quantity: 1,
  price: { lines: [], subtotalExGstCents: 6500, gstCents: 975, totalInclGstCents: 7475 },
  uploadReferences: [],
}] };

const intent: CheckoutStartingPaymentIntent = {
  schemaVersion: 1,
  phase: "starting_payment",
  orderIdempotencyKey: "70000000-0000-4000-8000-000000000001",
  paymentIdempotencyKey: "80000000-0000-4000-8000-000000000001",
  method: "card",
  checkoutVersion: 2,
  cartDigest: "a".repeat(64),
  shipping: {
    method: "pickup",
    serviceCode: "pickup",
    amountExGstCents: 0,
    gstCents: 0,
    amountInclGstCents: 0,
    isTest: false,
  },
  orderNumber: "RNR-2026-PENDING-CART",
};

const placingIntent: PlacingOrderIntent = {
  schemaVersion: 1,
  phase: "placing_order",
  orderIdempotencyKey: intent.orderIdempotencyKey,
  paymentIdempotencyKey: intent.paymentIdempotencyKey,
  method: intent.method,
  checkoutVersion: intent.checkoutVersion,
  cartDigest: intent.cartDigest,
  shipping: intent.shipping,
};

describe("pending checkout", () => {
  beforeEach(() => localStorage.clear());

  it("keeps the cart and resumable order in durable browser storage", () => {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));

    savePendingCheckout(localStorage, intent, cart);

    expect(readPendingCheckout(localStorage)).toEqual({ schemaVersion: 1, intent, cart });
    expect(pendingCheckoutMatchesCart(readPendingCheckout(localStorage), cart)).toBe(true);
    expect(localStorage.getItem(CART_STORAGE_KEY)).toBe(JSON.stringify(cart));
  });

  it("keeps the original cart and idempotency keys before the order response arrives", () => {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));

    savePendingCheckout(localStorage, placingIntent, cart);

    expect(readPendingCheckout(localStorage)).toEqual({
      schemaVersion: 1,
      intent: placingIntent,
      cart,
    });
    expect(localStorage.getItem(CART_STORAGE_KEY)).toBe(JSON.stringify(cart));
  });

  it("keeps a legacy Grave Cover checkout resumable after format normalization", () => {
    const legacyCart: Cart = {
      version: 1,
      items: [{
        ...cart.items[0],
        productKey: "grave-cover",
        productSlug: "grave-cover",
        productTitle: "Grave Cover",
        sizeKey: "standard",
        sizeLabel: "200 × 100 cm",
        orientation: "portrait",
      }],
    };
    localStorage.setItem(PENDING_CHECKOUT_STORAGE_KEY, JSON.stringify({
      schemaVersion: 1,
      intent,
      cart: legacyCart,
    }));

    const pending = readPendingCheckout(localStorage);
    expect(pending?.cart.items[0].sizeLabel).toBe("100 × 200 cm");
    expect(pending?.cart.items[0]).not.toHaveProperty("orientation");
  });

  it("removes malformed durable recovery data", () => {
    localStorage.setItem(PENDING_CHECKOUT_STORAGE_KEY, JSON.stringify({
      schemaVersion: 1,
      intent: { ...intent, clientSecret: "must-not-persist" },
      cart,
    }));

    expect(readPendingCheckout(localStorage)).toBeNull();
    expect(localStorage.getItem(PENDING_CHECKOUT_STORAGE_KEY)).toBeNull();
  });

  it("clears the matching cart only after its order is complete", () => {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
    savePendingCheckout(localStorage, intent, cart);

    expect(completePendingCheckout(localStorage, intent.orderNumber)).toBe(true);
    expect(localStorage.getItem(CART_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(PENDING_CHECKOUT_STORAGE_KEY)).toBeNull();
  });

  it("does not clear a cart changed after the pending order was created", () => {
    const changedCart: Cart = {
      ...cart,
      items: [{ ...cart.items[0], quantity: 2 }],
    };
    savePendingCheckout(localStorage, intent, cart);
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(changedCart));

    expect(completePendingCheckout(localStorage, intent.orderNumber)).toBe(false);
    expect(localStorage.getItem(CART_STORAGE_KEY)).toBe(JSON.stringify(changedCart));
    expect(localStorage.getItem(PENDING_CHECKOUT_STORAGE_KEY)).toBeNull();
  });

  it("only clears a recovery record for the matching order", () => {
    savePendingCheckout(localStorage, intent, cart);

    clearPendingCheckout(localStorage, "RNR-2026-OTHER");
    expect(readPendingCheckout(localStorage)).not.toBeNull();

    clearPendingCheckout(localStorage, intent.orderNumber);
    expect(readPendingCheckout(localStorage)).toBeNull();
  });
});
