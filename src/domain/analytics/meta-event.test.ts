import { describe, expect, it } from "vitest";
import type { PurchaseEvent } from "./events";
import {
  buildMetaEventId,
  normalizeMetaSourceUrl,
  toMetaBrowserEvent,
} from "./meta-event";

const purchase: PurchaseEvent = {
  event: "purchase",
  transaction_id: "RNR-2026-ABC",
  currency: "NZD",
  value: 100,
  total: 115,
  tax: 15,
  shipping: 0,
  items: [{ item_id: "photo-print-canvas", item_name: "Canvas", price: 100, quantity: 1 }],
};

describe("Meta event contract", () => {
  it("uses a deterministic paid-order ID and the supplied interaction UUID elsewhere", () => {
    expect(buildMetaEventId(purchase)).toBe("purchase:RNR-2026-ABC");
    expect(buildMetaEventId({ event: "generate_lead", method: "email" }, "00000000-0000-4000-8000-000000000001"))
      .toBe("00000000-0000-4000-8000-000000000001");
  });

  it("normalizes source URLs to the canonical origin and removes all sensitive URL state", () => {
    expect(normalizeMetaSourceUrl(new URL(
      "https://www.rrgallery.co.nz/products/photo-print-canvas?fbclid=click&access=secret#proof",
    ))).toBe("https://rnrgallery.com/products/photo-print-canvas");
    expect(normalizeMetaSourceUrl(new URL(
      "https://rnrgallery.com/orders/RNR-123?access=secret",
    ))).toBe("https://rnrgallery.com/orders/confirmation");
  });

  it("projects only approved browser fields and rejects browser Purchase", () => {
    const unsafeInput = {
      event: "add_to_cart",
      currency: "AUD",
      value: 75,
      customer_email: "private@example.test",
      items: [{
        item_id: "roll-up-banner",
        item_name: "Private custom title",
        item_variant: "standard",
        price: 75,
        quantity: 2,
        image_url: "/uploads/private.jpg",
      }],
    } as const;
    const event = toMetaBrowserEvent(
      unsafeInput,
      "00000000-0000-4000-8000-000000000002",
      "/cart?client_secret=private",
    );

    expect(event).toEqual({
      version: 1,
      eventId: "00000000-0000-4000-8000-000000000002",
      name: "AddToCart",
      sourcePath: "/cart",
      commerce: {
        contentIds: ["roll-up-banner"],
        contents: [{ id: "roll-up-banner", quantity: 2, itemPrice: 75 }],
        currency: "AUD",
        value: 75,
      },
    });
    expect(JSON.stringify(event)).not.toMatch(/private|image|item_name|variant/i);
    expect(toMetaBrowserEvent(purchase, crypto.randomUUID(), "/orders/RNR-2026-ABC"))
      .toBeNull();
  });
});
