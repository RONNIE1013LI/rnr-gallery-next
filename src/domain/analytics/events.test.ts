import { describe, expect, it, vi } from "vitest";

import type { PublicOrder } from "@/server/orders/order-query-service";
import { buildPurchaseEvent, emitAnalyticsEvent } from "./events";

function order(paymentStatus: PublicOrder["paymentStatus"]): PublicOrder {
  return {
    orderNumber: "RNR-2026-ABC123", createdAt: "2026-08-16T00:00:00.000Z",
    paymentStatus, fulfilmentStatus: "new", currency: "NZD", deliveryMethod: "post",
    shipping: { provider: "local-test", serviceName: "Post", isTest: true, amountExGstCents: 2000, gstCents: 300, amountInclGstCents: 2300 },
    totals: { productSubtotalExGstCents: 6500, productGstCents: 975, productTotalInclGstCents: 7475, totalExGstCents: 8500, totalGstCents: 1275, totalInclGstCents: 9775 },
    items: [{ productKey: "photo-print-canvas", productTitle: "Photo Print Canvas", sizeKey: "a4", sizeLabel: "A4", peoplePets: 0, photoSubmissionMethod: "later", designText: "PRIVATE", notes: "PRIVATE", neededDate: "2026-09-01", urgentServiceConfirmed: false, urgentWorkingDays: 5, quantity: 1, priceLines: [], uploadReferences: ["PRIVATE-FILE"], unitSubtotalExGstCents: 6500, unitGstCents: 975, unitTotalInclGstCents: 7475, lineSubtotalExGstCents: 6500, lineGstCents: 975, lineTotalInclGstCents: 7475 } as PublicOrder["items"][number]],
    addresses: { billing: { country: "NZ", fullName: "PRIVATE", building: "", street: "PRIVATE", suburb: "PRIVATE", region: "PRIVATE", postcode: "1010", phone: "PRIVATE", email: "private@example.test" }, delivery: { country: "NZ", fullName: "PRIVATE", building: "", street: "PRIVATE", suburb: "PRIVATE", region: "PRIVATE", postcode: "1010", phone: "PRIVATE", email: "private@example.test" } },
    payment: null,
  };
}

describe("privacy-safe analytics events", () => {
  it("builds purchase only from a server-confirmed paid order with stable real totals", () => {
    expect(buildPurchaseEvent(order("awaiting_payment"))).toBeNull();
    const event = buildPurchaseEvent(order("paid"));
    expect(event).toEqual({
      event: "purchase", transaction_id: "RNR-2026-ABC123", currency: "NZD",
      value: 97.75, tax: 12.75, shipping: 23,
      items: [{ item_id: "photo-print-canvas", item_name: "Photo Print Canvas", item_variant: "a4", price: 74.75, quantity: 1 }],
    });
    expect(JSON.stringify(event)).not.toContain("PRIVATE");
  });

  it("identifies Banner Bundle purchases without exposing customisation content or file data", () => {
    const paidOrder = order("paid");
    const bundleItem = {
      ...paidOrder.items[0],
      productKey: "banner-bundle",
      productTitle: "Celebration Display Package",
      sizeKey: "rollup-wall-200x100",
      sizeLabel: "Combined banner package",
      designText: "PRIVATE BUNDLE WORDING",
      notes: "PRIVATE BUNDLE NOTES",
      galleryDesign: {
        id: "a".repeat(64),
        title: "PRIVATE INSPIRATION",
        contentHash: "b".repeat(64),
        productSlug: "banner-bundle",
        imageUrl: "/gallery-images/private-banner-file.jpg",
      },
      uploadReferences: ["private-banner-filename.png"],
      bundleComponents: [{
        componentKey: "roll-up" as const,
        photoSubmissionMethod: "upload" as const,
        designText: "PRIVATE ROLL-UP WORDING",
        notes: "PRIVATE ROLL-UP NOTES",
        photoCount: 2,
        backgroundRemovalCount: 1,
      }, {
        componentKey: "wall-banner" as const,
        photoSubmissionMethod: "later" as const,
        designText: "PRIVATE WALL WORDING",
        notes: "PRIVATE WALL NOTES",
        photoCount: 0,
        backgroundRemovalCount: 0,
      }],
    } satisfies PublicOrder["items"][number] & {
      uploadReferences: readonly string[];
    };
    const bundleOrder = {
      ...paidOrder,
      items: [bundleItem],
    } satisfies PublicOrder;

    const event = buildPurchaseEvent(bundleOrder);

    expect(event?.items).toEqual([{
      item_id: "banner-bundle",
      item_name: "Celebration Display Package",
      item_variant: "rollup-wall-200x100",
      price: 74.75,
      quantity: 1,
    }]);
    expect(JSON.stringify(event)).not.toMatch(
      /PRIVATE|bundleComponents|designText|notes|uploadReferences|filename|imageUrl|gallery-images/i,
    );
  });

  it("uses the immutable order currency for Australian purchases", () => {
    const australianOrder = {
      ...order("paid"),
      currency: "AUD" as const,
      addresses: {
        billing: { ...order("paid").addresses.billing, country: "AU" as const },
        delivery: { ...order("paid").addresses.delivery, country: "AU" as const },
      },
    };

    expect(buildPurchaseEvent(australianOrder)).toMatchObject({
      transaction_id: "RNR-2026-ABC123",
      currency: "AUD",
      value: 97.75,
    });
  });

  it("does nothing and makes no request while Google analytics is disabled", () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_ANALYTICS_ENABLED", "");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    Object.assign(window, { dataLayer: [] });
    expect(emitAnalyticsEvent({ event: "generate_lead", method: "messenger" })).toBe(false);
    expect(window.dataLayer).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
