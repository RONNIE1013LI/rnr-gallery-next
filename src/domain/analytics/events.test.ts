import { describe, expect, it } from "vitest";

import type { Cart, CartItem } from "@/domain/cart/types";
import type { RepricedCheckoutCart } from "@/domain/checkout/types";
import type { PublicOrder } from "@/server/orders/order-query-service";
import {
  buildCartEvent,
  buildCartItemEvent,
  buildCheckoutEvent,
  buildProductViewEvent,
  buildPurchaseEvent,
} from "./events";

const privateValues = [
  "Private Person",
  "private@example.test",
  "021 555 0199",
  "10 Private Street",
  "PRIVATE DESIGN TEXT",
  "PRIVATE NOTES",
  "private-upload-token",
  "/private-image.jpg",
  "private-checkout-token",
  "private-payment-id",
] as const;

function expectPrivacySafe(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const privateValue of privateValues) {
    expect(serialized).not.toContain(privateValue);
  }
}

function cartItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    id: "private-checkout-token",
    productKey: "photo-print-canvas",
    productSlug: "photo-print-canvas",
    productTitle: "Photo Print Canvas",
    imageSrc: "/private-image.jpg",
    sizeKey: "a4",
    sizeLabel: "A4",
    peoplePets: 1,
    photoSubmissionMethod: "upload",
    designText: "PRIVATE DESIGN TEXT",
    notes: "PRIVATE NOTES",
    neededDate: "2026-09-01",
    deliveryPreference: "post",
    quantity: 1,
    price: {
      lines: [],
      subtotalExGstCents: 6_500,
      gstCents: 975,
      totalInclGstCents: 7_475,
    },
    uploadReferences: ["private-upload-token"],
    ...overrides,
  };
}

const nzdCart: Cart = { version: 1, items: [cartItem()] };

const audCheckout: RepricedCheckoutCart = {
  version: 1,
  market: "AU",
  currency: "AUD",
  taxJurisdiction: "AU_GST",
  taxRateBasisPoints: 1_000,
  priceBookRevision: 9,
  orderDate: "2026-08-17",
  items: [{
    clientItemId: "private-checkout-token",
    productKey: "photo-print-canvas",
    productSlug: "photo-print-canvas",
    productTitle: "Photo Print Canvas",
    galleryDesign: {
      id: "private-upload-token",
      title: "PRIVATE DESIGN TEXT",
      contentHash: "private-payment-id",
      productSlug: "photo-print-canvas",
      imageUrl: "/private-image.jpg",
    },
    sizeKey: "a4",
    sizeLabel: "A4",
    peoplePets: 1,
    photoSubmissionMethod: "upload",
    designText: "PRIVATE DESIGN TEXT",
    notes: "PRIVATE NOTES",
    neededDate: "2026-09-01",
    urgentServiceConfirmed: false,
    urgentService: { workingDays: 5, feeInclGstCents: 0 },
    quantity: 1,
    uploadReferences: ["private-upload-token"],
    unitPrice: {
      market: "AU",
      currency: "AUD",
      taxJurisdiction: "AU_GST",
      taxRateBasisPoints: 1_000,
      discountCents: 0,
      designSurchargeCents: 0,
      lines: [],
      subtotalExGstCents: 6_500,
      gstCents: 650,
      totalInclGstCents: 7_150,
    },
    lineSubtotalExGstCents: 6_500,
    lineGstCents: 650,
    lineTotalInclGstCents: 7_150,
  }],
  subtotalExGstCents: 6_500,
  gstCents: 650,
  totalInclGstCents: 7_150,
  discountCents: 0,
  designSurchargeCents: 0,
  itemCount: 1,
  cartDigest: "private-payment-id",
};

function order(paymentStatus: PublicOrder["paymentStatus"]): PublicOrder {
  return {
    orderNumber: "RNR-2026-ABC123",
    createdAt: "2026-08-16T00:00:00.000Z",
    paymentStatus,
    fulfilmentStatus: "new",
    currency: "NZD",
    deliveryMethod: "post",
    shipping: {
      provider: "local-test",
      serviceName: "Post",
      isTest: true,
      amountExGstCents: 2_000,
      gstCents: 300,
      amountInclGstCents: 2_300,
    },
    totals: {
      productSubtotalExGstCents: 6_500,
      productGstCents: 975,
      productTotalInclGstCents: 7_475,
      totalExGstCents: 8_500,
      totalGstCents: 1_275,
      totalInclGstCents: 9_775,
    },
    items: [{
      productKey: "photo-print-canvas",
      productTitle: "Photo Print Canvas",
      galleryDesign: {
        id: "private-upload-token",
        title: "PRIVATE DESIGN TEXT",
        contentHash: "private-checkout-token",
        productSlug: "photo-print-canvas",
        imageUrl: "/private-image.jpg",
      },
      sizeKey: "a4",
      sizeLabel: "A4",
      peoplePets: 0,
      photoSubmissionMethod: "later",
      designText: "PRIVATE DESIGN TEXT",
      notes: "PRIVATE NOTES",
      neededDate: "2026-09-01",
      urgentServiceConfirmed: false,
      urgentWorkingDays: 5,
      quantity: 1,
      priceLines: [],
      bundleComponents: [{
        componentKey: "roll-up",
        photoSubmissionMethod: "upload",
        designText: "PRIVATE DESIGN TEXT",
        notes: "PRIVATE NOTES",
        photoCount: 1,
        backgroundRemovalCount: 0,
      }],
      unitSubtotalExGstCents: 6_500,
      unitGstCents: 975,
      unitTotalInclGstCents: 7_475,
      lineSubtotalExGstCents: 6_500,
      lineGstCents: 975,
      lineTotalInclGstCents: 7_475,
    }],
    addresses: {
      billing: {
        country: "NZ",
        fullName: "Private Person",
        building: "",
        street: "10 Private Street",
        suburb: "Private Suburb",
        region: "Auckland",
        postcode: "1010",
        phone: "021 555 0199",
        email: "private@example.test",
      },
      delivery: {
        country: "NZ",
        fullName: "Private Person",
        building: "",
        street: "10 Private Street",
        suburb: "Private Suburb",
        region: "Auckland",
        postcode: "1010",
        phone: "021 555 0199",
        email: "private@example.test",
      },
    },
    payment: {
      method: "card",
      status: "paid",
      isTest: false,
      canRetry: false,
      providerReference: "private-payment-id",
    } as unknown as PublicOrder["payment"],
  };
}

describe("privacy-safe analytics events", () => {
  it("builds the exact allowlisted view_item payload", () => {
    expect(buildProductViewEvent({
      productKey: "photo-print-canvas",
      productName: "Photo Print Canvas",
      category: "Canvas",
      sizeKey: "a4",
      currency: "NZD",
      unitSubtotalExTaxCents: 6_500,
    })).toEqual({
      event: "view_item",
      currency: "NZD",
      value: 65,
      items: [{
        item_id: "photo-print-canvas",
        item_name: "Photo Print Canvas",
        item_category: "Canvas",
        item_variant: "a4",
        price: 65,
        quantity: 1,
      }],
    });
  });

  it.each(["add_to_cart", "remove_from_cart"] as const)(
    "builds the exact allowlisted %s payload",
    (name) => {
      const event = buildCartItemEvent(name, cartItem());
      expect(event).toEqual({
        event: name,
        currency: "NZD",
        value: 65,
        items: [{
          item_id: "photo-print-canvas",
          item_name: "Photo Print Canvas",
          item_variant: "a4",
          price: 65,
          quantity: 1,
        }],
      });
      expectPrivacySafe(event);
    },
  );

  it.each(["view_cart", "begin_checkout"] as const)(
    "builds the exact allowlisted %s payload",
    (name) => {
      const event = buildCartEvent(name, nzdCart);
      expect(event).toEqual({
        event: name,
        currency: "NZD",
        value: 65,
        items: [{
          item_id: "photo-print-canvas",
          item_name: "Photo Print Canvas",
          item_variant: "a4",
          price: 65,
          quantity: 1,
        }],
      });
      expectPrivacySafe(event);
    },
  );

  it.each([
    ["add_shipping_info", { shipping_tier: "AU Standard" }],
    ["add_payment_info", { payment_type: "afterpay" as const }],
  ] as const)("builds the exact allowlisted %s payload", (name, details) => {
    const event = buildCheckoutEvent(name, audCheckout, details);
    expect(event).toEqual({
      event: name,
      currency: "AUD",
      value: 65,
      items: [{
        item_id: "photo-print-canvas",
        item_name: "Photo Print Canvas",
        item_variant: "a4",
        price: 65,
        quantity: 1,
      }],
      ...details,
    });
    expectPrivacySafe(event);
  });

  it("returns null for empty or mixed-currency carts and unsafe money", () => {
    expect(buildCartEvent("view_cart", { version: 1, items: [] })).toBeNull();
    expect(buildCartEvent("view_cart", {
      version: 1,
      items: [
        cartItem(),
        cartItem({
          id: "aud-item",
          price: {
            ...cartItem().price,
            market: "AU",
            currency: "AUD",
            taxJurisdiction: "AU_GST",
            taxRateBasisPoints: 1_000,
            discountCents: 0,
            designSurchargeCents: 0,
          },
        }),
      ],
    })).toBeNull();
    expect(buildCartEvent("view_cart", {
      version: 1,
      items: [cartItem({
        price: { ...cartItem().price, subtotalExGstCents: Number.MAX_VALUE },
      })],
    })).toBeNull();
  });

  it("builds purchase only from a valid paid order using ex-tax product value", () => {
    expect(buildPurchaseEvent(order("awaiting_payment"))).toBeNull();
    const event = buildPurchaseEvent(order("paid"));
    expect(event).toEqual({
      event: "purchase",
      transaction_id: "RNR-2026-ABC123",
      currency: "NZD",
      value: 65,
      tax: 12.75,
      shipping: 23,
      items: [{
        item_id: "photo-print-canvas",
        item_name: "Photo Print Canvas",
        item_variant: "a4",
        price: 65,
        quantity: 1,
      }],
    });
    expectPrivacySafe(event);
  });

  it("rejects unsafe paid purchase totals", () => {
    const paidOrder = order("paid");
    expect(buildPurchaseEvent({
      ...paidOrder,
      totals: {
        ...paidOrder.totals,
        productSubtotalExGstCents: Number.MAX_VALUE,
      },
    })).toBeNull();
  });

  it("uses the immutable order currency for Australian purchases", () => {
    expect(buildPurchaseEvent({ ...order("paid"), currency: "AUD" })).toMatchObject({
      transaction_id: "RNR-2026-ABC123",
      currency: "AUD",
      value: 65,
    });
  });
});
