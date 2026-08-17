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
