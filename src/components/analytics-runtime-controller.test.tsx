import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GA4_DEBUG_SESSION_KEY,
  GA4_DISABLE_WINDOW_KEY,
  GA4_MEASUREMENT_ID,
} from "@/domain/analytics/runtime";
import { AnalyticsRuntimeController } from "./analytics-runtime-controller";

const googleAnalytics = vi.hoisted(() => ({
  automaticPageLocations: [] as string[],
  mounts: 0,
  props: [] as Array<Record<string, unknown>>,
}));

vi.mock("@next/third-parties/google", async () => {
  const React = await import("react");
  return {
    GoogleAnalytics: (props: Record<string, unknown>) => {
      googleAnalytics.props.push(props);
      React.useEffect(() => {
        googleAnalytics.mounts += 1;
        const disabled = (window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY] === true;
        if (!disabled) googleAnalytics.automaticPageLocations.push(window.location.href);
      }, []);
      return <script id="_next-ga" data-testid="official-google-analytics" />;
    },
    sendGAEvent: vi.fn(),
  };
});

function setLocation(pathname: string, search = "") {
  window.history.replaceState({}, "", `${pathname}${search ? `?${search}` : ""}`);
}

describe("AnalyticsRuntimeController", () => {
  beforeEach(() => {
    googleAnalytics.automaticPageLocations.length = 0;
    googleAnalytics.mounts = 0;
    googleAnalytics.props.length = 0;
    sessionStorage.clear();
    localStorage.clear();
    document.documentElement.removeAttribute("data-ga4-enabled");
    document.documentElement.removeAttribute("data-ga4-private-purchase");
    document.documentElement.removeAttribute("data-ga4-loaded");
    delete (window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY];
    setLocation("/");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sets the public marker before mounting one exact official tag", async () => {
    const view = render(<AnalyticsRuntimeController production />);

    await waitFor(() => expect(googleAnalytics.mounts).toBe(1));
    expect(document.documentElement.dataset.ga4Enabled).toBe("true");
    expect((window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY]).toBe(false);
    expect(googleAnalytics.props.at(-1)).toMatchObject({ gaId: GA4_MEASUREMENT_ID });
    expect(googleAnalytics.automaticPageLocations).toEqual(["http://localhost:3000/"]);

    act(() => window.history.pushState({}, "", "/products/photo-print-canvas"));
    expect(googleAnalytics.mounts).toBe(1);
    view.unmount();
  });

  it("blocks the direct access-token order URL before official GA initializes", async () => {
    setLocation("/orders/RNR-2026-PRIVATE", "access=private-email-token");

    render(<AnalyticsRuntimeController production />);

    await waitFor(() => expect(googleAnalytics.mounts).toBe(1));
    expect(googleAnalytics.automaticPageLocations).toEqual([]);
    expect(document.documentElement.dataset.ga4Enabled).toBeUndefined();
    expect(document.documentElement.dataset.ga4PrivatePurchase).toBe("true");
    expect((window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY]).toBe(true);
  });

  it("updates the privacy flag before SPA history observers can collect a location", async () => {
    const view = render(<AnalyticsRuntimeController production />);
    await waitFor(() => expect(googleAnalytics.mounts).toBe(1));

    const guardedPushState = window.history.pushState;
    const observedPageLocations: string[] = [];
    window.history.pushState = function (...args) {
      const result = guardedPushState.apply(this, args);
      if ((window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY] !== true) {
        observedPageLocations.push(window.location.href);
      }
      return result;
    };

    act(() => window.history.pushState(
      {},
      "",
      "/orders/RNR-2026-PRIVATE?access=private-spa-token",
    ));
    expect(observedPageLocations).toEqual([]);
    expect((window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY]).toBe(true);
    expect(document.documentElement.dataset.ga4Enabled).toBeUndefined();

    act(() => window.history.pushState({}, "", "/shop"));
    expect(observedPageLocations).toEqual(["http://localhost:3000/shop"]);
    expect(observedPageLocations.join(" ")).not.toContain("private-spa-token");
    expect((window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY]).toBe(false);
    expect(document.documentElement.dataset.ga4Enabled).toBe("true");
    expect(googleAnalytics.mounts).toBe(1);
    window.history.pushState = guardedPushState;
    view.unmount();
  });

  it("enables and clears debug mode at the root without an ecommerce event", async () => {
    setLocation("/", "ga_debug=1");
    const view = render(<AnalyticsRuntimeController production />);

    await waitFor(() => expect(sessionStorage.getItem(GA4_DEBUG_SESSION_KEY)).toBe("true"));
    expect(localStorage.getItem(GA4_DEBUG_SESSION_KEY)).toBeNull();
    expect(googleAnalytics.props.at(-1)).toMatchObject({ debugMode: true });

    act(() => window.history.replaceState({}, "", "/?ga_debug=0"));

    await waitFor(() => expect(sessionStorage.getItem(GA4_DEBUG_SESSION_KEY)).toBeNull());
    expect(googleAnalytics.props.at(-1)?.debugMode).toBe(false);
    view.unmount();
  });

  it("keeps non-production environments inert", async () => {
    setLocation("/", "ga_debug=1");
    render(<AnalyticsRuntimeController production={false} />);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(googleAnalytics.mounts).toBe(0);
    expect(sessionStorage.getItem(GA4_DEBUG_SESSION_KEY)).toBeNull();
    expect(document.documentElement.dataset.ga4Enabled).toBeUndefined();
    expect((window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY]).toBe(true);
  });

  it("marks the official script ready from its load event", async () => {
    const view = render(<AnalyticsRuntimeController production />);
    const script = await view.findByTestId("official-google-analytics");

    act(() => script.dispatchEvent(new Event("load")));
    expect(document.documentElement.dataset.ga4Loaded).toBe("true");
  });
});
