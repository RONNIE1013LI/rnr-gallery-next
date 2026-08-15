import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PurchaseEvent } from "@/domain/analytics/events";
import { PurchaseTracker } from "./purchase-tracker";

const event: PurchaseEvent = { event: "purchase", transaction_id: "RNR-2026-ONE", currency: "NZD", value: 97.75, tax: 12.75, shipping: 23, items: [] };

describe("PurchaseTracker", () => {
  beforeEach(() => {
    sessionStorage.clear();
    Object.assign(window, { dataLayer: [] });
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_ANALYTICS_ENABLED", "true");
  });

  it("emits one stable purchase per real order across repeated renders", async () => {
    const first = render(<PurchaseTracker event={event} />);
    await waitFor(() => expect(window.dataLayer).toEqual([event]));
    first.unmount();
    render(<PurchaseTracker event={event} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(window.dataLayer).toEqual([event]);
  });
});
