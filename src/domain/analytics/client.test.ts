import { beforeEach, describe, expect, it, vi } from "vitest";

import { sendGAEvent } from "@next/third-parties/google";
import { emitAnalyticsEvent } from "./client";
import { GA4_DEBUG_SESSION_KEY } from "./runtime";

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

describe("emitAnalyticsEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.removeAttribute("data-ga4-enabled");
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

  it("returns false until the official dataLayer transport is ready", () => {
    document.documentElement.dataset.ga4Enabled = "true";
    Object.assign(window, { dataLayer: undefined });

    expect(emitAnalyticsEvent(event)).toBe(false);
    expect(sendGAEvent).not.toHaveBeenCalled();

    Object.assign(window, { dataLayer: [] });
    expect(emitAnalyticsEvent(event)).toBe(true);
    expect(sendGAEvent).toHaveBeenCalledTimes(1);
  });

  it("fails open when debug session storage throws", () => {
    document.documentElement.dataset.ga4Enabled = "true";
    window.history.replaceState({}, "", "/?ga_debug=1");
    const setItem = vi.spyOn(Storage.prototype, "setItem")
      .mockImplementationOnce(() => {
        throw new Error("storage unavailable");
      });
    let result: boolean | undefined;

    try {
      expect(() => {
        result = emitAnalyticsEvent(event);
      }).not.toThrow();
    } finally {
      setItem.mockRestore();
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

  it("persists controlled debug mode only in sessionStorage", () => {
    document.documentElement.dataset.ga4Enabled = "true";
    window.history.replaceState({}, "", "/?ga_debug=1");

    expect(emitAnalyticsEvent(event)).toBe(true);
    expect(sessionStorage.getItem(GA4_DEBUG_SESSION_KEY)).toBe("true");
    expect(localStorage.getItem(GA4_DEBUG_SESSION_KEY)).toBeNull();
    expect(sendGAEvent).toHaveBeenLastCalledWith("event", "view_cart", {
      currency: "NZD",
      value: 65,
      items: event.items,
      debug_mode: true,
    });

    window.history.replaceState({}, "", "/");
    emitAnalyticsEvent(event);
    expect(sendGAEvent).toHaveBeenLastCalledWith("event", "view_cart", {
      currency: "NZD",
      value: 65,
      items: event.items,
      debug_mode: true,
    });
  });

  it("clears the controlled debug session with ga_debug=0", () => {
    document.documentElement.dataset.ga4Enabled = "true";
    sessionStorage.setItem(GA4_DEBUG_SESSION_KEY, "true");
    window.history.replaceState({}, "", "/?ga_debug=0");

    expect(emitAnalyticsEvent(event)).toBe(true);
    expect(sessionStorage.getItem(GA4_DEBUG_SESSION_KEY)).toBeNull();
    expect(sendGAEvent).toHaveBeenLastCalledWith("event", "view_cart", {
      currency: "NZD",
      value: 65,
      items: event.items,
    });
  });
});
