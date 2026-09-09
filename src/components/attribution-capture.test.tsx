import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAttributionStorageKey } from "@/domain/analytics/attribution";
import { readAttributionHistory, handoffAttributionHistory } from "@/domain/analytics/attribution-history";
const preferences = vi.hoisted(() => ({ analytics: true, advertising: true }));
vi.mock("next/navigation", () => ({ usePathname: () => window.location.pathname, useSearchParams: () => new URLSearchParams(window.location.search) }));
vi.mock("./consent-preferences", () => ({ useAdvertisingConsent: () => ({ ...preferences }) }));
import { AttributionCapture } from "./attribution-capture";

describe("AttributionCapture", () => {
  beforeEach(() => {
    preferences.analytics = true;
    preferences.advertising = true;
    sessionStorage.clear();
    localStorage.clear();
    window.history.replaceState({}, "", "/shop?utm_source=google&gclid=click-1");
  });

  it("persists campaign history beyond the session", async () => {
    render(<AttributionCapture customerId={null} />);
    await waitFor(() => expect(readAttributionHistory(localStorage, null)).not.toBeNull());
    sessionStorage.clear();
    expect(readAttributionHistory(localStorage, null)?.firstTouch.campaign.gclid).toBe("click-1");
  });

  it("does not reuse an external referrer on internal SPA navigation", async () => {
    Object.defineProperty(document, "referrer", { configurable: true, value: "https://www.google.com/search?q=canvas" });
    window.history.replaceState({}, "", "/?utm_source=meta&utm_medium=paid_social&fbclid=click_123");
    const view = render(<AttributionCapture customerId={null} />);
    await waitFor(() => expect(readAttributionHistory(localStorage, null)).not.toBeNull());
    const first = readAttributionHistory(localStorage, null)!;
    window.history.replaceState({}, "", "/canvas");
    view.rerender(<AttributionCapture customerId={null} />);
    expect(readAttributionHistory(localStorage, null)?.lastTouch).toEqual(first.lastTouch);
    Object.defineProperty(document, "referrer", { configurable: true, value: "" });
  });

  it("does not copy one tagged click to another identity on the same URL", async () => {
    const view = render(<AttributionCapture customerId={null} />);
    await waitFor(() => expect(sessionStorage.getItem(getAttributionStorageKey(null))).not.toBeNull());
    view.rerender(<AttributionCapture customerId="user-a" />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sessionStorage.getItem(getAttributionStorageKey("user-a"))).toBeNull();
  });
  it("clears handed-off history when consent is revoked after login on the same URL", () => {
    const view = render(<AttributionCapture customerId={null} />);
    handoffAttributionHistory(localStorage, "user-a");
    view.rerender(<AttributionCapture customerId="user-a" />);
    expect(readAttributionHistory(localStorage, "user-a")).not.toBeNull();
    preferences.analytics = false;
    preferences.advertising = false;
    view.rerender(<AttributionCapture customerId="user-a" />);
    expect(readAttributionHistory(localStorage, "user-a")).toBeNull();
  });
  it("captures analytics-only history when consent is granted on the same URL", () => {
    preferences.analytics = false;
    preferences.advertising = false;
    const view = render(<AttributionCapture customerId={null} />);
    expect(readAttributionHistory(localStorage, null)).toBeNull();
    preferences.analytics = true;
    view.rerender(<AttributionCapture customerId={null} />);
    const history = readAttributionHistory(localStorage, null);
    expect(history).not.toBeNull();
    expect(history?.firstTouch.campaign.gclid).toBeUndefined();
  });
});
