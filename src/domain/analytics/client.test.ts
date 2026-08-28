import { beforeEach, describe, expect, it, vi } from "vitest";

import { sendGAEvent } from "@next/third-parties/google";
import {
  beginGaHistorySuppression,
  emitAnalyticsEvent,
  endGaHistorySuppression,
  markGaTransportReady,
  resetGaTransport,
  sendControlledGaEvent,
} from "./client";
import type { PurchaseEvent } from "./events";
import {
  GA4_DEBUG_SESSION_KEY,
  GA4_DISABLE_WINDOW_KEY,
  GA4_MEASUREMENT_ID,
  GOOGLE_ADS_PURCHASE_SEND_TO,
  GOOGLE_ADS_TAG_ID,
  META_PIXEL_ID,
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
  total: 97.75,
  tax: 12.75,
  shipping: 23,
  items: event.items,
};

describe("emitAnalyticsEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetGaTransport();
    document.documentElement.removeAttribute("data-ga4-enabled");
    document.documentElement.removeAttribute("data-ga4-private-purchase");
    document.documentElement.removeAttribute("data-ga4-private-commerce");
    document.documentElement.removeAttribute("data-ga4-loaded");
    document.documentElement.removeAttribute("data-ga4-analytics-enabled");
    document.documentElement.removeAttribute("data-google-ads-enabled");
    document.documentElement.removeAttribute("data-meta-enabled");
    document.documentElement.removeAttribute("data-meta-private-commerce");
    document.documentElement.removeAttribute("data-meta-private-purchase");
    delete (window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY];
    window.history.replaceState({}, "", "/");
    sessionStorage.clear();
    localStorage.clear();
    Object.assign(window, { dataLayer: [] });
    document.documentElement.dataset.ga4AnalyticsEnabled = "true";
    document.documentElement.dataset.googleAdsEnabled = "true";
    markGaTransportReady();
  });

  it("does not emit unless the strict production DOM gate is enabled", () => {
    expect(emitAnalyticsEvent(event)).toBe(false);
    expect(sendGAEvent).not.toHaveBeenCalled();

    document.documentElement.dataset.ga4Enabled = "true";
    let disabledDuringSend: unknown;
    vi.mocked(sendGAEvent).mockImplementationOnce(() => {
      disabledDuringSend = (window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY];
    });
    expect(emitAnalyticsEvent(event)).toBe(true);
    expect(disabledDuringSend).toBe(false);
    expect((window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY]).toBe(false);
    expect(sendGAEvent).toHaveBeenCalledWith("event", "view_cart", {
      currency: "NZD",
      value: 65,
      items: event.items,
      page_location: "http://localhost:3000/",
      page_referrer: "",
      send_to: GA4_MEASUREMENT_ID,
    });
  });

  it("emits only the allowlisted quick-action intent and source", () => {
    document.documentElement.dataset.ga4Enabled = "true";

    expect(emitAnalyticsEvent({
      event: "chat_quick_action_clicked",
      intent: "quote",
      source: "chat_welcome",
    } as never)).toBe(true);
    expect(sendGAEvent).toHaveBeenCalledWith("event", "chat_quick_action_clicked", {
      intent: "quote",
      source: "chat_welcome",
      page_location: "http://localhost:3000/",
      page_referrer: "",
      send_to: GA4_MEASUREMENT_ID,
    });
  });

  it("keeps GA4 independent when Meta is enabled but an event is unsupported", () => {
    document.documentElement.dataset.ga4Enabled = "true";
    document.documentElement.dataset.metaEnabled = "true";

    expect(emitAnalyticsEvent(event)).toBe(true);
    expect(sendGAEvent).toHaveBeenCalledWith("event", "view_cart", expect.objectContaining({
      currency: "NZD",
      value: 65,
    }));
  });

  it("keeps Meta commerce independent when analytics transport is unavailable", () => {
    const fbq = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    Object.assign(window, { fbq });
    vi.stubGlobal("fetch", fetchMock);
    document.documentElement.dataset.metaEnabled = "true";
    document.documentElement.removeAttribute("data-ga4-enabled");
    Object.assign(window, { dataLayer: undefined });

    expect(emitAnalyticsEvent({ ...event, event: "view_item" })).toBe(true);
    expect(fbq).toHaveBeenCalledWith(
      "trackSingle",
      META_PIXEL_ID,
      "ViewContent",
      expect.objectContaining({ currency: "NZD", value: 65 }),
      { eventID: expect.any(String) },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sendGAEvent).not.toHaveBeenCalled();
  });

  it("queues the Ads-only conversion exactly once before recording its dedupe marker", () => {
    document.documentElement.dataset.ga4PrivatePurchase = "true";
    document.documentElement.dataset.ga4Loaded = "true";
    document.documentElement.dataset.googleAdsEnabled = "true";
    document.documentElement.removeAttribute("data-ga4-analytics-enabled");
    window.history.replaceState({}, "", "/orders/private?access=private-token");

    expect(emitAnalyticsEvent(purchase)).toBe(true);
    expect(emitAnalyticsEvent(purchase)).toBe(true);

    const commands = (window as unknown as { dataLayer: unknown[] }).dataLayer
      .map((command) => Array.from(command as ArrayLike<unknown>));
    expect(commands.filter((command) => command[0] === "event" && command[1] === "conversion"))
      .toEqual([["event", "conversion", expect.objectContaining({
        send_to: GOOGLE_ADS_PURCHASE_SEND_TO,
        transaction_id: "RNR-2026-PRIVATE",
        value: 97.75,
        currency: "NZD",
      })]]);
    expect(vi.mocked(sendGAEvent)).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("rnr:analytics:v1:purchase-destination:ads:RNR-2026-PRIVATE"))
      .toBe("sent");
  });

  it("pins pageview, view_item, and purchase to the configured destination", () => {
    document.documentElement.dataset.ga4Enabled = "true";
    sendControlledGaEvent("page_view", {
      page_location: "http://localhost:3000/products/photo-print-canvas?gclid=private-click",
      page_referrer: "",
      send_to: "G-MALICIOUS",
    });
    expect(emitAnalyticsEvent({ ...event, event: "view_item" })).toBe(true);

    document.documentElement.removeAttribute("data-ga4-enabled");
    document.documentElement.dataset.ga4PrivatePurchase = "true";
    document.documentElement.dataset.ga4Loaded = "true";
    window.history.replaceState({}, "", "/orders/private?access=private-token");
    expect(emitAnalyticsEvent(purchase)).toBe(true);

    expect(vi.mocked(sendGAEvent).mock.calls.map((command) => command[1]))
      .toEqual(["page_view", "view_item", "purchase"]);
    for (const command of vi.mocked(sendGAEvent).mock.calls.slice(0, 3)) {
      expect(command[2]).toMatchObject({ send_to: GA4_MEASUREMENT_ID });
    }
    expect((window as unknown as { dataLayer: unknown[] }).dataLayer).toContainEqual([
      "event",
      "conversion",
      expect.objectContaining({
      send_to: GOOGLE_ADS_PURCHASE_SEND_TO,
      transaction_id: "RNR-2026-PRIVATE",
      value: 97.75,
      currency: "NZD",
      }),
    ]);
    expect(JSON.stringify(vi.mocked(sendGAEvent).mock.calls))
      .not.toMatch(/G-MALICIOUS|gclid|private-click|private-token/);
  });

  it("returns false for null events", () => {
    document.documentElement.dataset.ga4Enabled = "true";
    expect(emitAnalyticsEvent(null)).toBe(false);
    expect(sendGAEvent).not.toHaveBeenCalled();
  });

  it("sends only allowlisted item-list fields", async () => {
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
    await new Promise((resolve) => window.setTimeout(resolve, 0));
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
      page_location: "http://localhost:3000/",
      page_referrer: "",
      send_to: GA4_MEASUREMENT_ID,
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
      page_location: "http://localhost:3000/",
      page_referrer: "",
      send_to: GA4_MEASUREMENT_ID,
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
      page_location: "http://localhost:3000/",
      page_referrer: "",
      send_to: GA4_MEASUREMENT_ID,
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
      page_location: "http://localhost:3000/",
      page_referrer: "",
      send_to: GA4_MEASUREMENT_ID,
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
      send_to: GA4_MEASUREMENT_ID,
    });
    expect((window as unknown as { dataLayer: unknown[] }).dataLayer).toContainEqual([
      "config",
      GOOGLE_ADS_TAG_ID,
      {
        send_page_view: false,
        page_location: "http://localhost:3000/",
        page_referrer: "",
      },
    ]);
    expect((window as unknown as { dataLayer: unknown[] }).dataLayer).toContainEqual([
      "event",
      "conversion",
      expect.objectContaining({
        send_to: GOOGLE_ADS_PURCHASE_SEND_TO,
        transaction_id: "RNR-2026-PRIVATE",
      }),
    ]);
    expect(JSON.stringify({
      dataLayer: (window as unknown as { dataLayer: unknown[] }).dataLayer,
      events: vi.mocked(sendGAEvent).mock.calls,
    })).not.toContain("private-email-token");
    expect((window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY]).toBe(true);
  });

  it("does not send a private purchase before the disabled tag has loaded", () => {
    document.documentElement.dataset.ga4PrivatePurchase = "true";
    (window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY] = true;

    expect(emitAnalyticsEvent(purchase)).toBe(false);
    expect(sendGAEvent).not.toHaveBeenCalled();
    expect((window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY]).toBe(true);
  });

  it("keeps allowlisted commerce events collectable for an asynchronous tag transport", async () => {
    const dataLayer: unknown[] = [];
    Object.assign(window, { dataLayer });
    document.documentElement.dataset.ga4Enabled = "true";
    document.documentElement.dataset.ga4Loaded = "true";
    vi.mocked(sendGAEvent).mockImplementation((...command) => {
      dataLayer.push(command);
    });

    expect(emitAnalyticsEvent({ ...event, event: "view_item" })).toBe(true);
    expect(emitAnalyticsEvent({ ...event, event: "add_to_cart" })).toBe(true);

    document.documentElement.removeAttribute("data-ga4-enabled");
    document.documentElement.dataset.ga4PrivateCommerce = "true";
    expect(emitAnalyticsEvent({ ...event, event: "begin_checkout" })).toBe(true);

    document.documentElement.removeAttribute("data-ga4-private-commerce");
    document.documentElement.dataset.ga4PrivatePurchase = "true";
    expect(emitAnalyticsEvent(purchase)).toBe(true);

    const collected: unknown[][] = [];
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    if ((window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY] !== true) {
      collected.push(...dataLayer.map((command) =>
        Array.from(command as ArrayLike<unknown>)));
    }

    expect(collected
      .filter((command) => command[0] === "event")
      .map((command) => command[1])).toEqual([
      "view_item",
      "add_to_cart",
      "begin_checkout",
      "purchase",
      "conversion",
    ]);
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    expect((window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY]).toBe(true);
  });

  it("never leaves a private URL visible to delayed automatic collection", async () => {
    const automaticLocations: string[] = [];
    const attemptAutomaticCollection = () => {
      if ((window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY] !== true) {
        automaticLocations.push(window.location.href);
      }
    };

    document.documentElement.dataset.ga4PrivatePurchase = "true";
    document.documentElement.dataset.ga4Loaded = "true";
    window.history.replaceState(
      {},
      "",
      "/orders/private-route-token?access=private-order-token",
    );
    expect(emitAnalyticsEvent(purchase)).toBe(true);
    expect((window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY]).toBe(true);
    window.setTimeout(attemptAutomaticCollection, 0);
    window.setTimeout(attemptAutomaticCollection, 260);
    await new Promise((resolve) => window.setTimeout(resolve, 300));

    document.documentElement.removeAttribute("data-ga4-private-purchase");
    document.documentElement.dataset.ga4PrivateCommerce = "true";
    window.history.replaceState(
      {},
      "",
      "/checkout?client_secret=private-checkout-token",
    );
    expect(emitAnalyticsEvent({ ...event, event: "begin_checkout" })).toBe(true);
    expect((window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY]).toBe(true);
    window.setTimeout(attemptAutomaticCollection, 0);
    window.setTimeout(attemptAutomaticCollection, 260);
    await new Promise((resolve) => window.setTimeout(resolve, 300));

    expect(automaticLocations).toEqual([]);
    expect(vi.mocked(sendGAEvent).mock.calls.at(-2)?.[2]).toMatchObject({
      page_location: "http://localhost:3000/",
      page_referrer: "",
      send_to: GA4_MEASUREMENT_ID,
    });
    expect(vi.mocked(sendGAEvent).mock.calls.at(-1)?.[2]).toMatchObject({
      page_location: "http://localhost:3000/checkout",
      page_referrer: "",
      send_to: GA4_MEASUREMENT_ID,
    });
    expect((window as unknown as { dataLayer: unknown[] }).dataLayer).toContainEqual([
      "event",
      "conversion",
      expect.objectContaining({
        page_location: "http://localhost:3000/",
        page_referrer: "",
        send_to: GOOGLE_ADS_PURCHASE_SEND_TO,
      }),
    ]);
    expect(JSON.stringify(vi.mocked(sendGAEvent).mock.calls))
      .not.toMatch(/private-route-token|private-order-token|private-checkout-token/);
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
      send_to: GA4_MEASUREMENT_ID,
    });
    expect(sendGAEvent).toHaveBeenNthCalledWith(2, "event", "add_shipping_info", {
      currency: "NZD",
      value: 65,
      items: beginCheckout.items,
      shipping_tier: "Standard delivery",
      page_location: "http://localhost:3000/checkout",
      page_referrer: "",
      send_to: GA4_MEASUREMENT_ID,
    });
    expect(sendGAEvent).toHaveBeenNthCalledWith(3, "event", "add_payment_info", {
      currency: "NZD",
      value: 65,
      items: beginCheckout.items,
      payment_type: "afterpay",
      page_location: "http://localhost:3000/checkout",
      page_referrer: "",
      send_to: GA4_MEASUREMENT_ID,
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

  it("keeps a Meta-first purchase incomplete until every enabled Google destination succeeds", () => {
    const fbq = vi.fn();
    Object.assign(window, { fbq, dataLayer: undefined });
    document.documentElement.dataset.metaEnabled = "true";
    document.documentElement.dataset.ga4PrivatePurchase = "true";
    document.documentElement.dataset.ga4Loaded = "true";
    document.documentElement.dataset.ga4AnalyticsEnabled = "true";
    document.documentElement.dataset.googleAdsEnabled = "true";

    expect(emitAnalyticsEvent(purchase)).toBe(false);
    expect(fbq).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("rnr:analytics:v1:purchase-destination:meta:RNR-2026-PRIVATE"))
      .toBe("sent");
    expect(sessionStorage.getItem("rnr:analytics:v1:purchase-destination:ga4:RNR-2026-PRIVATE"))
      .toBeNull();
    expect(sessionStorage.getItem("rnr:analytics:v1:purchase-destination:ads:RNR-2026-PRIVATE"))
      .toBeNull();

    delete (window as Window & { fbq?: unknown }).fbq;
    Object.assign(window, { dataLayer: [] });
    expect(emitAnalyticsEvent(purchase)).toBe(true);
    expect(fbq).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendGAEvent).mock.calls.map((command) => command[1]))
      .toEqual(["purchase"]);
    expect((window as unknown as { dataLayer: unknown[] }).dataLayer.filter(
      (command) => Array.from(command as ArrayLike<unknown>)[1] === "conversion",
    )).toHaveLength(1);
  });

  it("retries only an Ads destination whose owned queue failed", () => {
    document.documentElement.dataset.ga4PrivatePurchase = "true";
    document.documentElement.dataset.ga4Loaded = "true";
    (window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY] = true;
    const dataLayer: unknown[] = [];
    const originalPush = dataLayer.push;
    let rejectConversion = true;
    dataLayer.push = (...commands) => {
      if (rejectConversion && Array.isArray(commands[0]) && commands[0][0] === "event") {
        throw new Error("ads transport unavailable");
      }
      return originalPush.apply(dataLayer, commands);
    };
    Object.assign(window, { dataLayer });
    vi.mocked(sendGAEvent).mockImplementation(() => undefined);

    expect(emitAnalyticsEvent(purchase)).toBe(false);
    expect(vi.mocked(sendGAEvent).mock.calls.map((command) => command[1]))
      .toEqual(["purchase"]);
    expect(sessionStorage.getItem("rnr:analytics:v1:purchase-destination:ga4:RNR-2026-PRIVATE"))
      .toBe("sent");
    expect(sessionStorage.getItem("rnr:analytics:v1:purchase-destination:ads:RNR-2026-PRIVATE"))
      .toBeNull();

    rejectConversion = false;
    expect(emitAnalyticsEvent(purchase)).toBe(true);
    expect(vi.mocked(sendGAEvent).mock.calls.map((command) => command[1]))
      .toEqual(["purchase"]);
    expect(dataLayer.filter((command) => Array.from(command as ArrayLike<unknown>)[1] === "conversion"))
      .toHaveLength(1);
  });

  it("does not queue a purchase while history collection is suppressed", () => {
    document.documentElement.dataset.ga4PrivatePurchase = "true";
    document.documentElement.dataset.ga4Loaded = "true";
    (window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY] = true;

    beginGaHistorySuppression();
    expect(emitAnalyticsEvent(purchase)).toBe(false);
    expect(sendGAEvent).not.toHaveBeenCalled();
    endGaHistorySuppression();
    expect(sendGAEvent).not.toHaveBeenCalled();

    expect(emitAnalyticsEvent(purchase)).toBe(true);
    expect(vi.mocked(sendGAEvent).mock.calls.map((command) => command[1]))
      .toEqual(["purchase"]);
  });
});
