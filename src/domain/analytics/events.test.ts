import { describe, expect, it, vi } from "vitest";

import type { PublicOrder } from "@/server/orders/order-query-service";
import { buildPurchaseEvent, emitAnalyticsEvent } from "./events";

function order(paymentStatus: PublicOrder["paymentStatus"]): PublicOrder {
  return {
    orderNumber: "RNR-2026-ABC123", createdAt: "2026-08-16T00:00:00.000Z",
    paymentStatus, fulfilmentStatus: "new", currency: "NZD", deliveryMethod: "post",
    shipping: { provider: "local-test", serviceName: "Post", isTest: true, amountExGstCents: 2000, gstCents: 300, amountInclGstCents: 2300 },
    totals: { productSubtotalExGstCents: 6500, productGstCents: 975, productTotalInclGstCents: 7475, totalExGstCents: 8500, totalGstCents: 1275, totalInclGstCents: 9775 },
    items: [{ productTitle: "Photo Print Canvas", sizeLabel: "A4", peoplePets: 0, photoSubmissionMethod: "later", designText: "PRIVATE", notes: "PRIVATE", neededDate: "2026-09-01", urgentServiceConfirmed: false, urgentWorkingDays: 5, quantity: 1, priceLines: [], uploadReferences: ["PRIVATE-FILE"], unitSubtotalExGstCents: 6500, unitGstCents: 975, unitTotalInclGstCents: 7475, lineSubtotalExGstCents: 6500, lineGstCents: 975, lineTotalInclGstCents: 7475 } as PublicOrder["items"][number]],
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
      items: [{ item_id: "photo-print-canvas", item_name: "Photo Print Canvas", item_variant: "A4", price: 74.75, quantity: 1 }],
    });
    expect(JSON.stringify(event)).not.toContain("PRIVATE");
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
