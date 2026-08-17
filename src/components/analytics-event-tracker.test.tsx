import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { sendGAEvent } from "@next/third-parties/google";
import { AnalyticsEventTracker } from "./analytics-event-tracker";

vi.mock("@next/third-parties/google", () => ({ sendGAEvent: vi.fn() }));

const event = {
  event: "view_item",
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

describe("AnalyticsEventTracker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.dataset.ga4Enabled = "true";
    window.history.replaceState({}, "", "/");
    sessionStorage.clear();
    Object.assign(window, { dataLayer: [] });
  });

  it("does not emit the same scoped event again on rerender", async () => {
    const view = render(<AnalyticsEventTracker event={event} scopeKey="NZ:canvas:a4" />);
    await waitFor(() => expect(sendGAEvent).toHaveBeenCalledTimes(1));

    view.rerender(<AnalyticsEventTracker event={{ ...event }} scopeKey="NZ:canvas:a4" />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendGAEvent).toHaveBeenCalledTimes(1);
  });

  it("emits when the scope changes and after an unmount revisit", async () => {
    const view = render(<AnalyticsEventTracker event={event} scopeKey="NZ:canvas:a4" />);
    await waitFor(() => expect(sendGAEvent).toHaveBeenCalledTimes(1));

    view.rerender(<AnalyticsEventTracker event={event} scopeKey="AU:canvas:a4" />);
    await waitFor(() => expect(sendGAEvent).toHaveBeenCalledTimes(2));

    view.unmount();
    render(<AnalyticsEventTracker event={event} scopeKey="AU:canvas:a4" />);
    await waitFor(() => expect(sendGAEvent).toHaveBeenCalledTimes(3));
  });

  it("does not emit null events", async () => {
    render(<AnalyticsEventTracker event={null} scopeKey="NZ:canvas:a4" />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendGAEvent).not.toHaveBeenCalled();
  });
});
