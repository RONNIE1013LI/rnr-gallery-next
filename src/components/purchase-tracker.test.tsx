import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { sendGAEvent } from "@next/third-parties/google";
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
    sessionStorage.clear();
    document.documentElement.removeAttribute("data-ga4-enabled");
    window.history.replaceState({}, "", "/");
    Object.assign(window, { dataLayer: [] });
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

  it("does not deduplicate before dataLayer is ready and retries later", async () => {
    document.documentElement.dataset.ga4Enabled = "true";
    Object.assign(window, { dataLayer: undefined });
    const view = render(<PurchaseTracker event={event} />);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendGAEvent).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(storageKey)).toBeNull();

    Object.assign(window, { dataLayer: [] });
    view.rerender(<PurchaseTracker event={{ ...event }} />);
    await waitFor(() => expect(sendGAEvent).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem(storageKey)).toBe("sent");
  });
});
