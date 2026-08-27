import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PurchaseEvent } from "./events";
import { emitMetaAnalyticsEvent, resetMetaPixelForTests } from "./meta";
import { META_PIXEL_ID } from "./runtime";

const cartEvent = {
  event: "add_to_cart",
  currency: "NZD",
  value: 65,
  customer_email: "private@example.test",
  items: [{
    item_id: "photo-print-canvas",
    item_name: "Photo Print Canvas",
    item_variant: "a4",
    price: 65,
    quantity: 1,
    image_url: "/private-image.jpg",
  }],
} as const;

const purchase: PurchaseEvent = {
  event: "purchase",
  transaction_id: "RNR-2026-META",
  currency: "AUD",
  value: 169.99,
  total: 224.99,
  tax: 0,
  shipping: 55,
  items: [{
    item_id: "photo-print-canvas",
    item_name: "Photo Print Canvas",
    item_variant: "a1",
    price: 169.99,
    quantity: 1,
  }],
};

describe("Meta commerce transport", () => {
  const fbq = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    document.documentElement.removeAttribute("data-meta-enabled");
    document.documentElement.removeAttribute("data-meta-private-commerce");
    document.documentElement.removeAttribute("data-meta-private-purchase");
    Object.assign(window, { fbq });
    resetMetaPixelForTests();
  });

  it("maps allowlisted product data to the standard AddToCart event without private fields", () => {
    document.documentElement.dataset.metaEnabled = "true";

    expect(emitMetaAnalyticsEvent(cartEvent)).toBe(true);
    expect(fbq).toHaveBeenCalledWith("trackSingle", META_PIXEL_ID, "AddToCart", {
      content_ids: ["photo-print-canvas"],
      content_type: "product",
      contents: [{ id: "photo-print-canvas", quantity: 1, item_price: 65 }],
      currency: "NZD",
      value: 65,
    });
    expect(JSON.stringify(fbq.mock.calls)).not.toMatch(/private@example|private-image|item_name/);
  });

  it("permits checkout events only behind the private commerce gate", () => {
    const checkout = { ...cartEvent, event: "begin_checkout" } as const;

    expect(emitMetaAnalyticsEvent(checkout)).toBe(false);
    document.documentElement.dataset.metaPrivateCommerce = "true";
    expect(emitMetaAnalyticsEvent(checkout)).toBe(true);
    expect(fbq).toHaveBeenLastCalledWith(
      "trackSingle",
      META_PIXEL_ID,
      "InitiateCheckout",
      expect.objectContaining({ currency: "NZD", value: 65 }),
    );

    expect(emitMetaAnalyticsEvent({
      ...checkout,
      event: "add_payment_info",
      payment_type: "card",
    })).toBe(true);
    expect(fbq).toHaveBeenLastCalledWith(
      "trackSingle",
      META_PIXEL_ID,
      "AddPaymentInfo",
      expect.objectContaining({ currency: "NZD", value: 65 }),
    );
    expect(JSON.stringify(fbq.mock.calls)).not.toContain("card");
  });

  it("sends one stable Purchase event per transaction and uses the final charged total", () => {
    document.documentElement.dataset.metaPrivatePurchase = "true";

    expect(emitMetaAnalyticsEvent(purchase)).toBe(true);
    expect(emitMetaAnalyticsEvent(purchase)).toBe(true);
    expect(fbq).toHaveBeenCalledTimes(1);
    expect(fbq).toHaveBeenCalledWith(
      "trackSingle",
      META_PIXEL_ID,
      "Purchase",
      expect.objectContaining({ currency: "AUD", value: 224.99 }),
      { eventID: "purchase:RNR-2026-META" },
    );
  });

  it("does not emit unsupported or disabled events", () => {
    document.documentElement.dataset.metaEnabled = "true";

    expect(emitMetaAnalyticsEvent({
      event: "photo_upload_completed",
      product_id: "canvas",
      photo_count: 2,
    })).toBe(false);
    document.documentElement.removeAttribute("data-meta-enabled");
    expect(emitMetaAnalyticsEvent(cartEvent)).toBe(false);
    expect(fbq).not.toHaveBeenCalled();
  });
});
