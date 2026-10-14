import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildStoredOrderAttribution, getAttributionStorageKey, readAttribution } from "@/domain/analytics/attribution";
import { readAttributionHistory, handoffAttributionHistory } from "@/domain/analytics/attribution-history";
const preferences = vi.hoisted(() => ({ available: true, analytics: true, advertising: true }));
vi.mock("next/navigation", () => ({ usePathname: () => window.location.pathname, useSearchParams: () => new URLSearchParams(window.location.search) }));
vi.mock("./consent-preferences", () => ({ useAdvertisingConsent: () => preferences.available ? { ...preferences } : null }));
import { AttributionCapture } from "./attribution-capture";

describe("AttributionCapture", () => {
  beforeEach(() => {
    preferences.analytics = true;
    preferences.advertising = true;
    preferences.available = true;
    sessionStorage.clear();
    localStorage.clear();
    window.history.replaceState({}, "", "/shop?utm_source=google&gclid=click-1");
  });
  afterEach(() => vi.useRealTimers());

  it("captures a real OpenAI landing time without analytics consent and retains it across navigation", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T00:00:00.000Z"));
    preferences.analytics = false;
    window.history.replaceState({}, "", "/canvas?oppref=openai-click_123&opprefCapturedAt=2026-10-15T00:00:00.000Z");
    const view = render(<AttributionCapture customerId={null} />);
    expect(readAttribution(sessionStorage, null)).toEqual({ oppref: "openai-click_123", opprefCapturedAt: "2026-10-14T00:00:00.000Z" });
    expect(readAttributionHistory(localStorage, null)).toBeNull();
    vi.setSystemTime(new Date("2026-10-15T00:00:00.000Z"));
    window.history.replaceState({}, "", "/checkout");
    view.rerender(<AttributionCapture customerId={null} />);
    expect(readAttribution(sessionStorage, null)?.opprefCapturedAt).toBe("2026-10-14T00:00:00.000Z");
    expect(buildStoredOrderAttribution(readAttribution(sessionStorage, null), {
      version: 1, analytics: false, advertising: true, decidedAt: "2026-10-14T00:00:00.000Z",
    }, {}, new Date("2026-10-15T00:00:00.000Z"))?.measurement?.opprefCapturedAt).toBe("2026-10-14T00:00:00.000Z");
    preferences.advertising = false;
    view.rerender(<AttributionCapture customerId={null} />);
    expect(readAttribution(sessionStorage, null)).toBeNull();
  });

  it.each(["2026-09-01T00:00:00.000Z", undefined])("does not refresh a persisted same click dated %s", (opprefCapturedAt) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T00:00:00.000Z"));
    preferences.analytics = false;
    sessionStorage.setItem(getAttributionStorageKey(null), JSON.stringify({ oppref: "old_click", ...(opprefCapturedAt ? { opprefCapturedAt } : {}) }));
    window.history.replaceState({}, "", "/canvas?oppref=old_click");
    const view = render(<AttributionCapture customerId={null} />);
    expect(readAttribution(sessionStorage, null)).toEqual({ oppref: "old_click", ...(opprefCapturedAt ? { opprefCapturedAt } : {}) });
    view.unmount();
    render(<AttributionCapture customerId={null} />);
    expect(readAttribution(sessionStorage, null)?.opprefCapturedAt).toBe(opprefCapturedAt);
  });

  it.each([false, true])("does not copy a dated click into another identity when consent changes and analytics is %s", (analytics) => {
    preferences.analytics = analytics;
    window.history.replaceState({}, "", "/canvas?oppref=guest_click");
    const view = render(<AttributionCapture customerId={null} />);
    expect(readAttribution(sessionStorage, null)?.oppref).toBe("guest_click");
    preferences.advertising = false;
    view.rerender(<AttributionCapture customerId="user-a" />);
    preferences.advertising = true;
    view.rerender(<AttributionCapture customerId="user-a" />);
    expect(readAttribution(sessionStorage, "user-a")).toBeNull();
    expect(JSON.stringify(readAttributionHistory(localStorage, "user-a"))).not.toContain("oppref");
  });

  it.each(["2026-09-01T00:00:00.000Z", undefined])("does not give a persisted same click a fresh history time %s", (opprefCapturedAt) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T00:00:00.000Z"));
    sessionStorage.setItem(getAttributionStorageKey(null), JSON.stringify({ oppref: "old_click", ...(opprefCapturedAt ? { opprefCapturedAt } : {}) }));
    window.history.replaceState({}, "", "/canvas?oppref=old_click");
    render(<AttributionCapture customerId={null} />);
    const history = readAttributionHistory(localStorage, null);
    if (opprefCapturedAt) expect(history?.lastNonDirectTouch?.at).toBe("2026-09-01T00:00:00.000Z");
    else expect(JSON.stringify(history)).not.toContain("oppref");
  });

  it.each([false, null])("retains old click provenance while initial advertising consent is %s", (advertising) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T00:00:00.000Z"));
    sessionStorage.setItem(getAttributionStorageKey(null), JSON.stringify({ oppref: "old_click", opprefCapturedAt: "2026-09-01T00:00:00.000Z" }));
    window.history.replaceState({}, "", "/canvas?oppref=old_click");
    preferences.available = advertising !== null;
    preferences.advertising = false;
    const view = render(<AttributionCapture customerId={null} />);
    expect(readAttribution(sessionStorage, null)).toBeNull();
    preferences.available = true;
    preferences.advertising = true;
    view.rerender(<AttributionCapture customerId={null} />);
    expect(readAttribution(sessionStorage, null)?.opprefCapturedAt).toBe("2026-09-01T00:00:00.000Z");
    expect(readAttributionHistory(localStorage, null)?.lastNonDirectTouch?.at).toBe("2026-09-01T00:00:00.000Z");
  });

  it("purges the new identity's dated click when advertising is already revoked", () => {
    preferences.advertising = false;
    const view = render(<AttributionCapture customerId={null} />);
    sessionStorage.setItem(getAttributionStorageKey("user-a"), JSON.stringify({ oppref: "old_click", opprefCapturedAt: "2026-09-01T00:00:00.000Z" }));
    view.rerender(<AttributionCapture customerId="user-a" />);
    expect(readAttribution(sessionStorage, "user-a")).toBeNull();
  });

  it("persists campaign history beyond the session", async () => {
    render(<AttributionCapture customerId={null} />);
    await waitFor(() => expect(readAttributionHistory(localStorage, null)).not.toBeNull());
    sessionStorage.clear();
    expect(readAttributionHistory(localStorage, null)?.firstTouch.campaign.gclid).toBe("click-1");
  });

  it("retains an OpenAI click only while advertising consent is granted", () => {
    window.history.replaceState({}, "", "/shop?utm_source=chatgpt&oppref=openai-click_123");
    preferences.advertising = false;
    const view = render(<AttributionCapture customerId={null} />);
    expect(JSON.parse(sessionStorage.getItem(getAttributionStorageKey(null))!)).toEqual({ utm_source: "chatgpt" });
    preferences.advertising = true;
    view.rerender(<AttributionCapture customerId={null} />);
    expect(JSON.parse(sessionStorage.getItem(getAttributionStorageKey(null))!).oppref).toBe("openai-click_123");
    window.history.replaceState({}, "", "/checkout");
    preferences.advertising = false;
    view.rerender(<AttributionCapture customerId={null} />);
    expect(JSON.parse(sessionStorage.getItem(getAttributionStorageKey(null))!)).toEqual({ utm_source: "chatgpt" });
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
