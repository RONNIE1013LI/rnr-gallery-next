import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sendGAEvent } from "@next/third-parties/google";
import {
  markGaTransportReady,
  resetGaTransport,
} from "@/domain/analytics/client";
import type { PurchaseEvent } from "@/domain/analytics/events";
import {
  GA4_MEASUREMENT_ID,
  GOOGLE_ADS_PURCHASE_SEND_TO,
  GOOGLE_ADS_TAG_ID,
} from "@/domain/analytics/runtime";
import { PurchaseTracker } from "./purchase-tracker";

vi.mock("@next/third-parties/google", () => ({ sendGAEvent: vi.fn() }));

const event: PurchaseEvent = {
  event: "purchase",
  transaction_id: "RNR-2026-ONE",
  currency: "NZD",
  value: 65,
  total: 100.75,
  tax: 12.75,
  shipping: 23,
  items: [],
};

const storageKey = "rnr:analytics:v1:purchase:RNR-2026-ONE";

function setPrivateOrderLocation() {
  window.history.replaceState(
    {},
    "",
    "/orders/RNR-2026-ONE?access=private-token",
  );
  document.documentElement.dataset.ga4PrivatePurchase = "true";
}

function enablePrivatePurchaseDestinations() {
  document.documentElement.dataset.ga4Loaded = "true";
  document.documentElement.dataset.ga4AnalyticsEnabled = "true";
  document.documentElement.dataset.googleAdsEnabled = "true";
}

function googleAdsCommands() {
  return (window as unknown as { dataLayer: unknown[] }).dataLayer;
}

describe("PurchaseTracker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetGaTransport();
    markGaTransportReady();
    sessionStorage.clear();
    document.documentElement.removeAttribute("data-ga4-enabled");
    document.documentElement.removeAttribute("data-ga4-private-purchase");
    document.documentElement.removeAttribute("data-ga4-loaded");
    document.documentElement.removeAttribute("data-ga4-analytics-enabled");
    document.documentElement.removeAttribute("data-google-ads-enabled");
    window.history.replaceState({}, "", "/");
    Object.assign(window, { dataLayer: [] });
  });

  afterEach(() => {
    resetGaTransport();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("records a purchase only after the official production transport emits", async () => {
    setPrivateOrderLocation();
    const view = render(<PurchaseTracker event={event} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendGAEvent).not.toHaveBeenCalled();
    expect(googleAdsCommands()).toEqual([]);
    expect(sessionStorage.getItem(storageKey)).toBeNull();

    enablePrivatePurchaseDestinations();
    view.rerender(<PurchaseTracker event={{ ...event }} />);
    await waitFor(() => expect(sendGAEvent).toHaveBeenCalledWith(
      "event",
      "purchase",
      {
        transaction_id: "RNR-2026-ONE",
        currency: "NZD",
        value: 65,
        tax: 12.75,
        shipping: 23,
        items: [],
        page_location: "http://localhost:3000/",
        page_referrer: "",
        send_to: GA4_MEASUREMENT_ID,
      },
    ));
    expect(sendGAEvent).toHaveBeenCalledTimes(1);
    expect(googleAdsCommands()).toContainEqual([
      "config",
      GOOGLE_ADS_TAG_ID,
      {
        send_page_view: false,
        page_location: "http://localhost:3000/",
        page_referrer: "",
      },
    ]);
    expect(googleAdsCommands()).toContainEqual([
      "event",
      "conversion",
      {
        transaction_id: "RNR-2026-ONE",
        currency: "NZD",
        value: 100.75,
        page_location: "http://localhost:3000/",
        page_referrer: "",
        send_to: GOOGLE_ADS_PURCHASE_SEND_TO,
      },
    ]);
    expect(JSON.stringify(googleAdsCommands())).not.toContain("private-token");
    expect(sessionStorage.getItem(storageKey)).toBe("sent");
  });

  it("emits one stable purchase per real order across repeated mounts", async () => {
    setPrivateOrderLocation();
    enablePrivatePurchaseDestinations();
    const first = render(<PurchaseTracker event={event} />);
    await waitFor(() => expect(sendGAEvent).toHaveBeenCalledTimes(1));
    expect(googleAdsCommands().filter(
      (command) => Array.isArray(command)
        && command[0] === "event"
        && command[1] === "conversion",
    )).toHaveLength(1);

    first.unmount();
    render(<PurchaseTracker event={event} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendGAEvent).toHaveBeenCalledTimes(1);
    expect(googleAdsCommands().filter(
      (command) => Array.isArray(command)
        && command[0] === "event"
        && command[1] === "conversion",
    )).toHaveLength(1);
    expect(sessionStorage.getItem(storageKey)).toBe("sent");
  });

  it("automatically retries readiness without a prop rerender", async () => {
    vi.useFakeTimers();
    setPrivateOrderLocation();
    enablePrivatePurchaseDestinations();
    Object.assign(window, { dataLayer: undefined });
    render(<PurchaseTracker event={event} />);

    expect(sendGAEvent).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(storageKey)).toBeNull();

    Object.assign(window, { dataLayer: [] });
    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    expect(sendGAEvent).toHaveBeenCalledTimes(1);
    expect(googleAdsCommands()).toContainEqual([
      "event",
      "conversion",
      expect.objectContaining({
        transaction_id: "RNR-2026-ONE",
        send_to: GOOGLE_ADS_PURCHASE_SEND_TO,
      }),
    ]);
    expect(sessionStorage.getItem(storageKey)).toBe("sent");

    await act(async () => {
      vi.runAllTimers();
    });
    expect(sendGAEvent).toHaveBeenCalledTimes(1);
    expect(googleAdsCommands().filter(
      (command) => Array.isArray(command)
        && command[0] === "event"
        && command[1] === "conversion",
    )).toHaveLength(1);
  });

  it("cancels a pending readiness retry on unmount", async () => {
    vi.useFakeTimers();
    document.documentElement.dataset.ga4Enabled = "true";
    Object.assign(window, { dataLayer: undefined });
    const view = render(<PurchaseTracker event={event} />);
    expect(vi.getTimerCount()).toBe(1);

    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    Object.assign(window, { dataLayer: [] });
    await act(async () => {
      vi.runAllTimers();
    });

    expect(sendGAEvent).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(storageKey)).toBeNull();
  });

  it("does not schedule or send an already-deduplicated purchase", async () => {
    vi.useFakeTimers();
    document.documentElement.dataset.ga4Enabled = "true";
    sessionStorage.setItem(storageKey, "sent");
    const setTimeout = vi.spyOn(window, "setTimeout");

    render(<PurchaseTracker event={event} />);
    expect(setTimeout).not.toHaveBeenCalledWith(expect.any(Function), 250);
    await act(async () => {
      vi.runAllTimers();
    });

    expect(sendGAEvent).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(storageKey)).toBe("sent");
  });
});
