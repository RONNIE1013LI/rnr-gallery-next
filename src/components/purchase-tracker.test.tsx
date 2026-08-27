import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sendGAEvent } from "@next/third-parties/google";
import {
  markGaTransportReady,
  resetGaTransport,
} from "@/domain/analytics/client";
import type { PurchaseEvent } from "@/domain/analytics/events";
import { PurchaseTracker } from "./purchase-tracker";

vi.mock("@next/third-parties/google", () => ({ sendGAEvent: vi.fn() }));

const event: PurchaseEvent = {
  event: "purchase",
  transaction_id: "RNR-2026-ONE",
  currency: "NZD",
  value: 65,
  tax: 12.75,
  shipping: 23,
  items: [],
};

const storageKey = "rnr:analytics:v1:purchase:RNR-2026-ONE";

describe("PurchaseTracker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetGaTransport();
    markGaTransportReady();
    sessionStorage.clear();
    document.documentElement.removeAttribute("data-ga4-enabled");
    window.history.replaceState({}, "", "/");
    Object.assign(window, { dataLayer: [] });
  });

  afterEach(() => {
    resetGaTransport();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("records a purchase only after the official production transport emits", async () => {
    const view = render(<PurchaseTracker event={event} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendGAEvent).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(storageKey)).toBeNull();

    document.documentElement.dataset.ga4Enabled = "true";
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
      },
    ));
    expect(sessionStorage.getItem(storageKey)).toBe("sent");
  });

  it("emits one stable purchase per real order across repeated mounts", async () => {
    document.documentElement.dataset.ga4Enabled = "true";
    const first = render(<PurchaseTracker event={event} />);
    await waitFor(() => expect(sendGAEvent).toHaveBeenCalledTimes(1));

    first.unmount();
    render(<PurchaseTracker event={event} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendGAEvent).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(storageKey)).toBe("sent");
  });

  it("automatically retries readiness without a prop rerender", async () => {
    vi.useFakeTimers();
    document.documentElement.dataset.ga4Enabled = "true";
    Object.assign(window, { dataLayer: undefined });
    render(<PurchaseTracker event={event} />);

    expect(sendGAEvent).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(storageKey)).toBeNull();

    Object.assign(window, { dataLayer: [] });
    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    expect(sendGAEvent).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(storageKey)).toBe("sent");

    await act(async () => {
      vi.runAllTimers();
    });
    expect(sendGAEvent).toHaveBeenCalledTimes(1);
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
