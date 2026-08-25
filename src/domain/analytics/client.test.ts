import { beforeEach, describe, expect, it, vi } from "vitest";

import { sendGAEvent } from "@next/third-parties/google";
import { emitAnalyticsEvent } from "./client";
import type { PurchaseEvent } from "./events";
import {
  GA4_DEBUG_SESSION_KEY,
  GA4_DISABLE_WINDOW_KEY,
} from "./runtime";

vi.mock("@next/third-parties/google", () => ({ sendGAEvent: vi.fn() }));

const event = {
  event: "view_cart",
  currency: "NZD",
  value: 65,
  items: [{
    item_id: "photo-print-canvas",
    item_name: "Photo Print Canvas",
    item_variant: "a4",
    price: 65,
    quantity: 1,
  }],
} as const;

const purchase: PurchaseEvent = {
  event: "purchase",
  transaction_id: "RNR-2026-PRIVATE",
  currency: "NZD",
  value: 65,
  tax: 12.75,
  shipping: 23,
  items: event.items,
};

describe("emitAnalyticsEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.removeAttribute("data-ga4-enabled");
    document.documentElement.removeAttribute("data-ga4-private-purchase");
    document.documentElement.removeAttribute("data-ga4-private-commerce");
    document.documentElement.removeAttribute("data-ga4-loaded");
    delete (window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY];
    window.history.replaceState({}, "", "/");
    sessionStorage.clear();
    localStorage.clear();
    Object.assign(window, { dataLayer: [] });
  });

  it("does not emit unless the strict production DOM gate is enabled", () => {
    expect(emitAnalyticsEvent(event)).toBe(false);
    expect(sendGAEvent).not.toHaveBeenCalled();

    document.documentElement.dataset.ga4Enabled = "true";
    expect(emitAnalyticsEvent(event)).toBe(true);
    expect(sendGAEvent).toHaveBeenCalledWith("event", "view_cart", {
      currency: "NZD",
      value: 65,
      items: event.items,
    });
  });

  it("returns false for null events", () => {
    document.documentElement.dataset.ga4Enabled = "true";
    expect(emitAnalyticsEvent(null)).toBe(false);
    expect(sendGAEvent).not.toHaveBeenCalled();
  });

  it("sends only allowlisted item-list fields", () => {
    document.documentElement.dataset.ga4Enabled = "true";
    const listEvent = {
      event: "select_item",
      item_list_id: "nz:shop",
      item_list_name: "Shop",
      currency: "NZD",
      value: 74.75,
      customer_email: "private@example.test",
      items: [{
        item_id: "photo-print-canvas",
        item_name: "Photo Print Canvas",
        item_category: "Canvas",
        price: 74.75,
        quantity: 1,
        index: 0,
        upload_reference: "private-upload-token",
      }],
    } as const;

    expect(emitAnalyticsEvent(listEvent)).toBe(true);
    expect(sendGAEvent).toHaveBeenCalledWith("event", "select_item", {
      item_list_id: "nz:shop",
      item_list_name: "Shop",
      currency: "NZD",
      value: 74.75,
      items: [{
        item_id: "photo-print-canvas",
        item_name: "Photo Print Canvas",
        item_category: "Canvas",
        price: 74.75,
        quantity: 1,
        index: 0,
      }],
    });
    expect(JSON.stringify(vi.mocked(sendGAEvent).mock.calls))
      .not.toContain("private@example.test");
    expect(JSON.stringify(vi.mocked(sendGAEvent).mock.calls))
      .not.toContain("private-upload-token");
  });

  it("returns false until the official dataLayer transport is ready", () => {
    document.documentElement.dataset.ga4Enabled = "true";
    Object.assign(window, { dataLayer: undefined });

    expect(emitAnalyticsEvent(event)).toBe(false);
    expect(sendGAEvent).not.toHaveBeenCalled();

    Object.assign(window, { dataLayer: [] });
    expect(emitAnalyticsEvent(event)).toBe(true);
    expect(sendGAEvent).toHaveBeenCalledTimes(1);
  });

  it("fails open when reading debug session storage throws", () => {
    document.documentElement.dataset.ga4Enabled = "true";
    const getItem = vi.spyOn(Storage.prototype, "getItem")
      .mockImplementationOnce(() => {
        throw new Error("storage unavailable");
      });
    let result: boolean | undefined;

    try {
      expect(() => {
        result = emitAnalyticsEvent(event);
      }).not.toThrow();
    } finally {
      getItem.mockRestore();
    }

    expect(result).toBe(false);
    expect(sendGAEvent).not.toHaveBeenCalled();
  });

  it("fails open when the official analytics helper throws", () => {
    document.documentElement.dataset.ga4Enabled = "true";
    vi.mocked(sendGAEvent).mockImplementationOnce(() => {
      throw new Error("transport unavailable");
    });
    let result: boolean | undefined;

    expect(() => {
      result = emitAnalyticsEvent(event);
    }).not.toThrow();

    expect(result).toBe(false);
    expect(sendGAEvent).toHaveBeenCalledTimes(1);
  });

  it("rebuilds the payload from the runtime allowlist before transport", () => {
    document.documentElement.dataset.ga4Enabled = "true";
    const eventWithPrivateFields = {
      ...event,
      customer_name: "Private Person",
      email: "private@example.test",
      address: "10 Private Street",
      checkout_token: "private-checkout-token",
      payment_provider_reference: "private-payment-id",
      items: event.items.map((item) => ({
        ...item,
        design_text: "PRIVATE DESIGN TEXT",
        upload_reference: "private-upload-token",
        image_url: "/private-image.jpg",
      })),
    };

    expect(emitAnalyticsEvent(eventWithPrivateFields)).toBe(true);
    expect(sendGAEvent).toHaveBeenCalledWith("event", "view_cart", {
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
  });

  it("uses the root-controlled debug session without reading the query", () => {
    document.documentElement.dataset.ga4Enabled = "true";
    sessionStorage.setItem(GA4_DEBUG_SESSION_KEY, "true");
    window.history.replaceState({}, "", "/?ga_debug=0");

    expect(emitAnalyticsEvent(event)).toBe(true);
    expect(sessionStorage.getItem(GA4_DEBUG_SESSION_KEY)).toBe("true");
    expect(localStorage.getItem(GA4_DEBUG_SESSION_KEY)).toBeNull();
    expect(sendGAEvent).toHaveBeenLastCalledWith("event", "view_cart", {
      currency: "NZD",
      value: 65,
      items: event.items,
      debug_mode: true,
    });
  });

  it("omits debug mode after the root controller clears its session", () => {
    document.documentElement.dataset.ga4Enabled = "true";
    sessionStorage.setItem(GA4_DEBUG_SESSION_KEY, "true");
    sessionStorage.removeItem(GA4_DEBUG_SESSION_KEY);

    expect(emitAnalyticsEvent(event)).toBe(true);
    expect(sessionStorage.getItem(GA4_DEBUG_SESSION_KEY)).toBeNull();
    expect(sendGAEvent).toHaveBeenLastCalledWith("event", "view_cart", {
      currency: "NZD",
      value: 65,
      items: event.items,
    });
  });

  it("permits only purchase on a private order location after the tag loaded", () => {
    document.documentElement.dataset.ga4PrivatePurchase = "true";
    document.documentElement.dataset.ga4Loaded = "true";
    (window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY] = true;
    window.history.replaceState(
      {},
      "",
      "/orders/RNR-2026-PRIVATE?access=private-email-token",
    );
    let disabledDuringSend: unknown;
    vi.mocked(sendGAEvent).mockImplementationOnce(() => {
      disabledDuringSend = (window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY];
    });

    expect(emitAnalyticsEvent(event)).toBe(false);
    expect(emitAnalyticsEvent(purchase)).toBe(true);
    expect(disabledDuringSend).toBe(false);
    expect(sendGAEvent).toHaveBeenCalledTimes(1);
    expect(sendGAEvent).toHaveBeenCalledWith("event", "purchase", {
      transaction_id: "RNR-2026-PRIVATE",
      currency: "NZD",
      value: 65,
      tax: 12.75,
      shipping: 23,
      items: purchase.items,
      page_location: "http://localhost:3000/",
      page_referrer: "",
    });
    expect(JSON.stringify(vi.mocked(sendGAEvent).mock.calls)).not.toContain("private-email-token");
    expect((window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY]).toBe(true);
  });

  it("does not send a private purchase before the disabled tag has loaded", () => {
    document.documentElement.dataset.ga4PrivatePurchase = "true";
    (window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY] = true;

    expect(emitAnalyticsEvent(purchase)).toBe(false);
    expect(sendGAEvent).not.toHaveBeenCalled();
    expect((window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY]).toBe(true);
  });

  it("sends only allowlisted checkout events with a safe location while automatic collection stays disabled", () => {
    document.documentElement.dataset.ga4PrivateCommerce = "true";
    document.documentElement.dataset.ga4Loaded = "true";
    (window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY] = true;
    window.history.replaceState({}, "", "/checkout?client_secret=private-checkout-secret");
    const beginCheckout = { ...event, event: "begin_checkout" } as const;
    let disabledDuringSend: unknown;
    vi.mocked(sendGAEvent).mockImplementation(() => {
      disabledDuringSend = (window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY];
    });

    expect(emitAnalyticsEvent(event)).toBe(false);
    expect(emitAnalyticsEvent(beginCheckout)).toBe(true);
    expect(emitAnalyticsEvent({
      ...event,
      event: "add_shipping_info",
      shipping_tier: "Standard delivery",
    })).toBe(true);
    expect(emitAnalyticsEvent({
      ...event,
      event: "add_payment_info",
      payment_type: "afterpay",
    })).toBe(true);
    expect(disabledDuringSend).toBe(false);
    expect(sendGAEvent).toHaveBeenCalledTimes(3);
    expect(sendGAEvent).toHaveBeenNthCalledWith(1, "event", "begin_checkout", {
      currency: "NZD",
      value: 65,
      items: beginCheckout.items,
      page_location: "http://localhost:3000/checkout",
      page_referrer: "",
    });
    expect(sendGAEvent).toHaveBeenNthCalledWith(2, "event", "add_shipping_info", {
      currency: "NZD",
      value: 65,
      items: beginCheckout.items,
      shipping_tier: "Standard delivery",
      page_location: "http://localhost:3000/checkout",
      page_referrer: "",
    });
    expect(sendGAEvent).toHaveBeenNthCalledWith(3, "event", "add_payment_info", {
      currency: "NZD",
      value: 65,
      items: beginCheckout.items,
      payment_type: "afterpay",
      page_location: "http://localhost:3000/checkout",
      page_referrer: "",
    });
    expect(JSON.stringify(vi.mocked(sendGAEvent).mock.calls)).not.toContain("private-checkout-secret");
    expect((window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY]).toBe(true);
  });

  it("restores private collection disablement when purchase transport throws", () => {
    document.documentElement.dataset.ga4PrivatePurchase = "true";
    document.documentElement.dataset.ga4Loaded = "true";
    (window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY] = true;
    vi.mocked(sendGAEvent).mockImplementationOnce(() => {
      expect((window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY]).toBe(false);
      throw new Error("transport unavailable");
    });

    expect(emitAnalyticsEvent(purchase)).toBe(false);
    expect((window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY]).toBe(true);
  });
});
