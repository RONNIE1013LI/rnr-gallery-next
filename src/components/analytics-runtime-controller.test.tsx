import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendGAEvent } from "@next/third-parties/google";

import {
  GA4_DEBUG_SESSION_KEY,
  GA4_DISABLE_WINDOW_KEY,
  GA4_MEASUREMENT_ID,
} from "@/domain/analytics/runtime";
import { emitAnalyticsEvent } from "@/domain/analytics/client";
import { AnalyticsRuntimeController } from "./analytics-runtime-controller";

const googleAnalytics = vi.hoisted(() => ({
  automaticPageLocations: [] as string[],
  commands: [] as unknown[][],
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
        const gaWindow = window as unknown as { dataLayer?: unknown[] };
        const dataLayer = gaWindow.dataLayer ??= [];
        dataLayer.push(["js", "official-component"]);
        dataLayer.push(["config", props.gaId]);
        googleAnalytics.commands = dataLayer.map((command) =>
          Array.from(command as ArrayLike<unknown>),
        );
        const config = googleAnalytics.commands.findLast((command) =>
          command[0] === "config" && command[1] === props.gaId,
        );
        const options = config?.[2] as Record<string, unknown> | undefined;
        if (options?.send_page_view !== false) {
          googleAnalytics.automaticPageLocations.push(window.location.href);
        }
      }, [props.gaId]);
      return <script id="_next-ga" data-testid="official-google-analytics" />;
    },
    sendGAEvent: vi.fn(),
  };
});

function setLocation(pathname: string, search = "") {
  window.history.replaceState({}, "", `${pathname}${search ? `?${search}` : ""}`);
}

function markGoogleTagReady() {
  Object.assign(window, {
    google_tag_manager: { [GA4_MEASUREMENT_ID]: {} },
  });
}

function loadGoogleTag(script: HTMLElement) {
  markGoogleTagReady();
  act(() => script.dispatchEvent(new Event("load")));
}

function loadGoogleTagScriptOnly(script: HTMLElement) {
  act(() => script.dispatchEvent(new Event("load")));
}

describe("AnalyticsRuntimeController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    googleAnalytics.automaticPageLocations.length = 0;
    googleAnalytics.commands.length = 0;
    googleAnalytics.mounts = 0;
    googleAnalytics.props.length = 0;
    sessionStorage.clear();
    localStorage.clear();
    document.documentElement.removeAttribute("data-ga4-enabled");
    document.documentElement.removeAttribute("data-ga4-private-purchase");
    document.documentElement.removeAttribute("data-ga4-private-commerce");
    document.documentElement.removeAttribute("data-ga4-loaded");
    delete (window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY];
    delete (window as unknown as { dataLayer?: unknown[] }).dataLayer;
    delete (window as unknown as { google_tag_manager?: unknown }).google_tag_manager;
    setLocation("/");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("suppresses automatic config collection and sends one safe public pageview", async () => {
    setLocation("/products/photo-print-canvas", [
      "utm_source=google",
      "utm_medium=cpc",
      "gclid=private-click-id",
      "gbraid=private-gbraid",
      "wbraid=private-wbraid",
    ].join("&"));
    const view = render(<AnalyticsRuntimeController production />);

    await waitFor(() => expect(googleAnalytics.mounts).toBe(1));
    expect(document.documentElement.dataset.ga4Enabled).toBeUndefined();
    expect((window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY]).toBe(true);
    expect(googleAnalytics.automaticPageLocations).toEqual([]);
    expect(googleAnalytics.commands.slice(0, 4)).toEqual([
      ["consent", "default", {
        analytics_storage: "granted",
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
      }],
      ["config", GA4_MEASUREMENT_ID, { send_page_view: false }],
      ["js", "official-component"],
      ["config", GA4_MEASUREMENT_ID, { send_page_view: false }],
    ]);

    const script = await view.findByTestId("official-google-analytics");
    loadGoogleTag(script);

    expect(document.documentElement.dataset.ga4Enabled).toBe("true");
    expect((window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY]).toBe(false);
    expect(googleAnalytics.props.at(-1)).toMatchObject({ gaId: GA4_MEASUREMENT_ID });
    expect(sendGAEvent).toHaveBeenCalledWith("event", "page_view", {
      page_location: "http://localhost:3000/products/photo-print-canvas",
      page_referrer: "",
    });
    expect(sendGAEvent).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(vi.mocked(sendGAEvent).mock.calls)).not.toMatch(
      /utm_source|utm_medium|gclid|gbraid|wbraid|private-click-id/,
    );
    expect(googleAnalytics.mounts).toBe(1);
    view.unmount();
    expect((window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY]).toBe(true);
  });

  it("queues initial pageview and view_item until the tag becomes ready after 250ms", async () => {
    setLocation(
      "/products/photo-print-canvas",
      "utm_source=google&gclid=private-initial-click",
    );
    const collected: unknown[][] = [];
    vi.mocked(sendGAEvent).mockImplementation((...command) => {
      const gaWindow = window as unknown as { dataLayer?: unknown[] };
      gaWindow.dataLayer?.push(command);
    });
    const view = render(<AnalyticsRuntimeController production />);
    const script = await view.findByTestId("official-google-analytics");
    const dataLayer = (window as unknown as { dataLayer?: unknown[] }).dataLayer ?? [];
    let processedCommands = 0;
    const transport = window.setInterval(() => {
      const manager = (window as unknown as {
        google_tag_manager?: Record<string, unknown>;
      }).google_tag_manager;
      if (!manager?.[GA4_MEASUREMENT_ID]) return;
      while (processedCommands < dataLayer.length) {
        const command = Array.from(
          dataLayer[processedCommands] as ArrayLike<unknown>,
        );
        processedCommands += 1;
        if (command[0] === "event"
          && (window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY] !== true) {
          collected.push(command);
        }
      }
    }, 20);

    loadGoogleTagScriptOnly(script);
    expect(emitAnalyticsEvent({
      event: "view_item",
      currency: "NZD",
      value: 65,
      items: [{
        item_id: "photo-print-canvas",
        item_name: "Photo Print Canvas",
        price: 65,
        quantity: 1,
      }],
    })).toBe(true);

    try {
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 350));
        markGoogleTagReady();
        await new Promise((resolve) => window.setTimeout(resolve, 100));
      });

      expect(collected.map((command) => command[1])).toEqual([
        "page_view",
        "view_item",
      ]);
      expect(collected[0]).toEqual(["event", "page_view", {
        page_location: "http://localhost:3000/products/photo-print-canvas",
        page_referrer: "",
      }]);
      expect(JSON.stringify(collected)).not.toMatch(/utm_source|gclid|private-initial-click/);
    } finally {
      window.clearInterval(transport);
      view.unmount();
    }
  });

  it("keeps a queued public event on its safe source page after navigating to a private URL", async () => {
    setLocation(
      "/products/photo-print-canvas",
      "utm_source=google&gclid=private-public-click",
    );
    const view = render(<AnalyticsRuntimeController production />);
    const script = await view.findByTestId("official-google-analytics");
    loadGoogleTagScriptOnly(script);

    expect(emitAnalyticsEvent({
      event: "view_item",
      currency: "NZD",
      value: 65,
      items: [{
        item_id: "photo-print-canvas",
        item_name: "Photo Print Canvas",
        price: 65,
        quantity: 1,
      }],
    })).toBe(true);

    await act(async () => {
      window.history.pushState(
        {},
        "",
        "/orders/RNR-2026-PRIVATE?access=private-order-token",
      );
      await new Promise((resolve) => window.setTimeout(resolve, 350));
      markGoogleTagReady();
      await new Promise((resolve) => window.setTimeout(resolve, 900));
    });

    const viewItemCall = vi.mocked(sendGAEvent).mock.calls.find(
      (command) => command[1] === "view_item",
    );
    expect(viewItemCall).toEqual(["event", "view_item", {
      currency: "NZD",
      value: 65,
      items: [{
        item_id: "photo-print-canvas",
        item_name: "Photo Print Canvas",
        price: 65,
        quantity: 1,
      }],
      page_location: "http://localhost:3000/products/photo-print-canvas",
      page_referrer: "",
    }]);
    expect(JSON.stringify(vi.mocked(sendGAEvent).mock.calls))
      .not.toMatch(/utm_source|gclid|private-public-click|RNR-2026-PRIVATE|private-order-token/);
    expect(document.documentElement.dataset.ga4Enabled).toBeUndefined();
    expect((window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY])
      .toBe(false);
    view.unmount();
  });

  it("suppresses delayed Enhanced Measurement before sending one queued SPA pageview", async () => {
    setLocation("/checkout", "client_secret=private-checkout-token");
    const view = render(<AnalyticsRuntimeController production />);
    const script = await view.findByTestId("official-google-analytics");
    loadGoogleTagScriptOnly(script);
    vi.mocked(sendGAEvent).mockClear();

    const collected: unknown[][] = [];
    const gaWindow = window as unknown as { dataLayer?: unknown[] };
    const dataLayer = gaWindow.dataLayer ??= [];
    let processedCommands = dataLayer.length;
    vi.mocked(sendGAEvent).mockImplementation((...command) => {
      dataLayer.push(command);
    });
    const transport = window.setInterval(() => {
      while (processedCommands < dataLayer.length) {
        const command = Array.from(
          dataLayer[processedCommands] as ArrayLike<unknown>,
        );
        processedCommands += 1;
        if (command[0] === "event"
          && (window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY] !== true) {
          collected.push(command);
        }
      }
    }, 20);

    let observedLocation = window.location.href;
    const enhancedMeasurement = window.setInterval(() => {
      if (window.location.href === observedLocation) return;
      observedLocation = window.location.href;
      if ((window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY] !== true) {
        googleAnalytics.automaticPageLocations.push(window.location.href);
      }
    }, 1_000);

    try {
      await act(async () => {
        window.history.pushState(
          {},
          "",
          "/products/banner-bundle?utm_source=delayed&gclid=private-delayed-click",
        );
        await Promise.resolve();
      });

      expect(sendGAEvent).not.toHaveBeenCalled();

      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 350));
        markGoogleTagReady();
        await new Promise((resolve) => window.setTimeout(resolve, 100));
      });
      expect(sendGAEvent).not.toHaveBeenCalled();
      expect((window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY])
        .toBe(true);

      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 800));
      });

      expect(googleAnalytics.automaticPageLocations).toEqual([]);
      expect(sendGAEvent).toHaveBeenCalledOnce();
      expect(collected).toEqual([["event", "page_view", {
        page_location: "http://localhost:3000/products/banner-bundle",
        page_referrer: "",
      }]]);
      expect(JSON.stringify(collected))
        .not.toMatch(/utm_source|gclid|private-delayed-click|private-checkout-token/);
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 300));
      });
      expect((window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY])
        .toBe(true);
    } finally {
      window.clearInterval(transport);
      window.clearInterval(enhancedMeasurement);
      view.unmount();
    }
  });

  it("records each rapid public history location once without reopening Enhanced Measurement", async () => {
    setLocation("/checkout", "client_secret=private-start-token");
    const view = render(<AnalyticsRuntimeController production />);
    const script = await view.findByTestId("official-google-analytics");
    loadGoogleTag(script);
    vi.mocked(sendGAEvent).mockClear();

    let observedLocation = window.location.href;
    const automaticLocations: string[] = [];
    const enhancedMeasurement = window.setInterval(() => {
      if (window.location.href === observedLocation) return;
      observedLocation = window.location.href;
      if ((window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY] !== true) {
        automaticLocations.push(window.location.href);
      }
    }, 1_000);

    try {
      await act(async () => {
        window.history.pushState(
          {},
          "",
          "/products/photo-print-canvas?utm_source=first&gclid=private-first-click",
        );
        await new Promise((resolve) => window.setTimeout(resolve, 300));
        window.history.pushState(
          {},
          "",
          "/products/banner-bundle?utm_source=second&gclid=private-second-click",
        );
        await new Promise((resolve) => window.setTimeout(resolve, 1_250));
      });

      expect(automaticLocations).toEqual([]);
      const pageViews = vi.mocked(sendGAEvent).mock.calls.filter(
        (command) => command[1] === "page_view",
      );
      expect(pageViews).toEqual([
        ["event", "page_view", {
          page_location: "http://localhost:3000/products/photo-print-canvas",
          page_referrer: "",
        }],
        ["event", "page_view", {
          page_location: "http://localhost:3000/products/banner-bundle",
          page_referrer: "",
        }],
      ]);
      expect(JSON.stringify(pageViews))
        .not.toMatch(/utm_source|gclid|private-first-click|private-second-click|private-start-token/);
    } finally {
      window.clearInterval(enhancedMeasurement);
      view.unmount();
    }
  });

  it("keeps a Link commerce event when private history suppression starts immediately", async () => {
    setLocation("/shop", "utm_source=catalogue");
    const view = render(<AnalyticsRuntimeController production />);
    const script = await view.findByTestId("official-google-analytics");
    loadGoogleTag(script);
    vi.mocked(sendGAEvent).mockClear();

    const collected: unknown[][] = [];
    const gaWindow = window as unknown as { dataLayer?: unknown[] };
    const dataLayer = gaWindow.dataLayer ??= [];
    let processedCommands = dataLayer.length;
    vi.mocked(sendGAEvent).mockImplementation((...command) => {
      dataLayer.push(command);
    });
    const transport = window.setInterval(() => {
      while (processedCommands < dataLayer.length) {
        const command = Array.from(
          dataLayer[processedCommands] as ArrayLike<unknown>,
        );
        processedCommands += 1;
        if (command[0] === "event"
          && (window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY] !== true) {
          collected.push(command);
        }
      }
    }, 20);

    try {
      await act(async () => {
        expect(emitAnalyticsEvent({
          event: "select_item",
          item_list_id: "nz:shop",
          item_list_name: "Shop",
          currency: "NZD",
          value: 65,
          items: [{
            item_id: "photo-print-canvas",
            item_name: "Photo Print Canvas",
            price: 65,
            quantity: 1,
            index: 0,
          }],
        })).toBe(true);
        window.history.pushState(
          {},
          "",
          "/orders/RNR-2026-PRIVATE?access=private-link-token",
        );
        await new Promise((resolve) => window.setTimeout(resolve, 1_250));
      });

      expect(collected).toEqual([["event", "select_item", {
        currency: "NZD",
        value: 65,
        items: [{
          item_id: "photo-print-canvas",
          item_name: "Photo Print Canvas",
          price: 65,
          quantity: 1,
          index: 0,
        }],
        item_list_id: "nz:shop",
        item_list_name: "Shop",
        page_location: "http://localhost:3000/shop",
        page_referrer: "",
      }]]);
      expect(JSON.stringify(collected))
        .not.toMatch(/utm_source|RNR-2026-PRIVATE|private-link-token/);
      expect(document.documentElement.dataset.ga4Enabled).toBeUndefined();
    } finally {
      window.clearInterval(transport);
      view.unmount();
    }
  });

  it("blocks the direct access-token order URL before official GA initializes", async () => {
    setLocation("/orders/RNR-2026-PRIVATE", "access=private-email-token");

    const view = render(<AnalyticsRuntimeController production />);

    await waitFor(() => expect(googleAnalytics.mounts).toBe(1));
    const script = await view.findByTestId("official-google-analytics");
    loadGoogleTag(script);
    expect(googleAnalytics.automaticPageLocations).toEqual([]);
    expect(document.documentElement.dataset.ga4Enabled).toBeUndefined();
    expect(document.documentElement.dataset.ga4PrivatePurchase).toBe("true");
    expect((window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY]).toBe(true);
  });

  it("never sends a directly loaded notification verification token to analytics", async () => {
    const privateToken = "private-direct-notification-token";
    setLocation(`/notification-email/verify/${privateToken}`);

    const view = render(<AnalyticsRuntimeController production />);

    await waitFor(() => expect(googleAnalytics.mounts).toBe(1));
    const script = await view.findByTestId("official-google-analytics");
    loadGoogleTag(script);
    expect(googleAnalytics.automaticPageLocations).toEqual([]);
    expect(sendGAEvent).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.ga4Enabled).toBeUndefined();
    expect((window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY]).toBe(true);
    expect(JSON.stringify({
      automaticPageLocations: googleAnalytics.automaticPageLocations,
      props: googleAnalytics.props,
      calls: vi.mocked(sendGAEvent).mock.calls,
    })).not.toContain(privateToken);
  });

  it("marks checkout for allowlisted commerce while keeping automatic collection disabled", async () => {
    setLocation("/checkout");
    const view = render(<AnalyticsRuntimeController production />);

    await waitFor(() => expect(googleAnalytics.mounts).toBe(1));
    const script = await view.findByTestId("official-google-analytics");
    loadGoogleTag(script);

    expect(document.documentElement.dataset.ga4PrivateCommerce).toBe("true");
    expect(document.documentElement.dataset.ga4Enabled).toBeUndefined();
    expect((window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY]).toBe(true);
    expect(sendGAEvent).not.toHaveBeenCalled();
  });

  it("keeps private-to-public history disabled until a safe pageview replaces referrer context", async () => {
    const view = render(<AnalyticsRuntimeController production />);
    await waitFor(() => expect(googleAnalytics.mounts).toBe(1));
    const script = await view.findByTestId("official-google-analytics");
    loadGoogleTag(script);
    vi.mocked(sendGAEvent).mockClear();

    const guardedPushState = window.history.pushState;
    const observedPageLocations: string[] = [];
    window.history.pushState = function (...args) {
      const result = guardedPushState.apply(this, args);
      if ((window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY] !== true) {
        observedPageLocations.push(window.location.href);
      }
      return result;
    };

    await act(async () => {
      window.history.pushState(
        {},
        "",
        "/orders/RNR-2026-PRIVATE?access=private-spa-token",
      );
      await Promise.resolve();
    });
    expect(observedPageLocations).toEqual([]);
    expect((window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY]).toBe(true);
    expect(document.documentElement.dataset.ga4Enabled).toBeUndefined();

    await act(async () => {
      window.history.pushState({}, "", "/shop");
      await new Promise((resolve) => window.setTimeout(resolve, 1_250));
    });
    expect(observedPageLocations).toEqual([]);
    expect(sendGAEvent).toHaveBeenCalledTimes(1);
    expect(sendGAEvent).toHaveBeenCalledWith("event", "page_view", {
      page_location: "http://localhost:3000/shop",
      page_referrer: "",
    });
    expect(JSON.stringify(vi.mocked(sendGAEvent).mock.calls)).not.toContain("private-spa-token");
    expect((window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY]).toBe(false);
    expect(document.documentElement.dataset.ga4Enabled).toBe("true");
    expect(googleAnalytics.mounts).toBe(1);
    window.history.pushState = guardedPushState;
    view.unmount();
    expect((window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY]).toBe(true);
  });

  it("blocks a notification verification token during SPA navigation then resumes safely", async () => {
    const privateToken = "private-spa-notification-token";
    const view = render(<AnalyticsRuntimeController production />);
    await waitFor(() => expect(googleAnalytics.mounts).toBe(1));
    const script = await view.findByTestId("official-google-analytics");
    loadGoogleTag(script);
    vi.mocked(sendGAEvent).mockClear();

    await act(async () => {
      window.history.pushState({}, "", `/notification-email/verify/${privateToken}`);
      await Promise.resolve();
    });

    expect(sendGAEvent).not.toHaveBeenCalled();
    expect((window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY]).toBe(true);
    expect(JSON.stringify({
      automaticPageLocations: googleAnalytics.automaticPageLocations,
      props: googleAnalytics.props,
      calls: vi.mocked(sendGAEvent).mock.calls,
    })).not.toContain(privateToken);

    await act(async () => {
      window.history.pushState({}, "", "/shop");
      await new Promise((resolve) => window.setTimeout(resolve, 1_250));
    });
    expect(sendGAEvent).toHaveBeenCalledOnce();
    expect(sendGAEvent).toHaveBeenCalledWith("event", "page_view", {
      page_location: "http://localhost:3000/shop",
      page_referrer: "",
    });
    expect(JSON.stringify(vi.mocked(sendGAEvent).mock.calls)).not.toContain(privateToken);
    expect((window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY]).toBe(false);
    view.unmount();
    expect((window as unknown as Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY]).toBe(true);
  });

  it("enables and clears debug mode at the root without an ecommerce event", async () => {
    setLocation("/", "ga_debug=1");
    const view = render(<AnalyticsRuntimeController production />);

    await waitFor(() => expect(sessionStorage.getItem(GA4_DEBUG_SESSION_KEY)).toBe("true"));
    expect(localStorage.getItem(GA4_DEBUG_SESSION_KEY)).toBeNull();
    expect(googleAnalytics.props.at(-1)).not.toHaveProperty("debugMode");
    const script = await view.findByTestId("official-google-analytics");
    loadGoogleTag(script);
    expect(sendGAEvent).toHaveBeenCalledWith("event", "page_view", {
      page_location: "http://localhost:3000/",
      page_referrer: "",
      debug_mode: true,
    });

    await act(async () => {
      window.history.replaceState({}, "", "/?ga_debug=0");
      await Promise.resolve();
    });

    await waitFor(() => expect(sessionStorage.getItem(GA4_DEBUG_SESSION_KEY)).toBeNull());
    expect(googleAnalytics.props.at(-1)).not.toHaveProperty("debugMode");
    expect(googleAnalytics.mounts).toBe(1);
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

    loadGoogleTag(script);
    expect(document.documentElement.dataset.ga4Loaded).toBe("true");
  });
});
