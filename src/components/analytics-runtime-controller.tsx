"use client";

import { GoogleAnalytics } from "@next/third-parties/google";
import { useLayoutEffect, useRef, useState } from "react";
import { sendControlledGaEvent } from "@/domain/analytics/client";
import {
  classifyGa4Location,
  GA4_DEBUG_SESSION_KEY,
  GA4_DISABLE_WINDOW_KEY,
  GA4_MEASUREMENT_ID,
  type Ga4LocationPolicy,
} from "@/domain/analytics/runtime";

type Ga4Window = Window & Record<string, unknown>;

const ga4ConsentDefaults = {
  analytics_storage: "granted",
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
} as const;

function initializeGa4DataLayer(): () => void {
  const gaWindow = window as Ga4Window & { dataLayer?: unknown[] };
  const dataLayer = Array.isArray(gaWindow.dataLayer) ? gaWindow.dataLayer : [];
  gaWindow.dataLayer = dataLayer;
  const originalPush = dataLayer.push;
  const guardedPush: typeof dataLayer.push = (...commands) => originalPush.apply(
    dataLayer,
    commands.map((command) => {
      const values = Array.from(command as ArrayLike<unknown>);
      if (values[0] !== "config" || values[1] !== GA4_MEASUREMENT_ID) return command;
      const options = values[2] !== null
        && typeof values[2] === "object"
        && !Array.isArray(values[2])
        ? values[2] as Record<string, unknown>
        : {};
      return ["config", GA4_MEASUREMENT_ID, { ...options, send_page_view: false }];
    }),
  );
  dataLayer.push = guardedPush;
  dataLayer.push(["consent", "default", ga4ConsentDefaults]);
  dataLayer.push(["config", GA4_MEASUREMENT_ID, { send_page_view: false }]);

  return () => {
    if (dataLayer.push === guardedPush) dataLayer.push = originalPush;
  };
}

function setCollectionDisabled(disabled: boolean) {
  (window as Ga4Window)[GA4_DISABLE_WINDOW_KEY] = disabled;
}

function controlledDebugMode(url: URL): boolean {
  try {
    const control = url.searchParams.get("ga_debug");
    if (control === "1") {
      window.sessionStorage.setItem(GA4_DEBUG_SESSION_KEY, "true");
    } else if (control === "0") {
      window.sessionStorage.removeItem(GA4_DEBUG_SESSION_KEY);
    }
    return window.sessionStorage.getItem(GA4_DEBUG_SESSION_KEY) === "true";
  } catch {
    return false;
  }
}

export function applyGa4LocationPolicy(
  url: URL,
  production: boolean,
  collectionReady = true,
): Readonly<{ debugMode: boolean; policy: Ga4LocationPolicy }> {
  const root = document.documentElement;
  const policy = classifyGa4Location(url.pathname, url.searchParams);

  if (!production) {
    root.removeAttribute("data-ga4-enabled");
    root.removeAttribute("data-ga4-private-commerce");
    root.removeAttribute("data-ga4-private-purchase");
    root.removeAttribute("data-ga4-loaded");
    setCollectionDisabled(true);
    return { debugMode: false, policy };
  }

  const debugMode = controlledDebugMode(url);
  if (policy === "public") {
    root.removeAttribute("data-ga4-private-commerce");
    root.removeAttribute("data-ga4-private-purchase");
    if (collectionReady) {
      root.dataset.ga4Enabled = "true";
      setCollectionDisabled(true);
    } else {
      root.removeAttribute("data-ga4-enabled");
      setCollectionDisabled(true);
    }
  } else {
    root.removeAttribute("data-ga4-enabled");
    if (policy === "private-checkout") {
      root.dataset.ga4PrivateCommerce = "true";
    } else {
      root.removeAttribute("data-ga4-private-commerce");
    }
    if (policy === "private-order") {
      root.dataset.ga4PrivatePurchase = "true";
    } else {
      root.removeAttribute("data-ga4-private-purchase");
    }
    setCollectionDisabled(true);
  }

  return { debugMode, policy };
}

function resolveHistoryUrl(url: string | URL | null | undefined): URL {
  return url === null || url === undefined
    ? new URL(window.location.href)
    : new URL(String(url), window.location.href);
}

export function installGa4HistoryGuard(
  beforeLocation: (url: URL) => void,
  afterLocation: (url: URL) => void,
): () => void {
  const originalPushState = window.history.pushState;
  const originalReplaceState = window.history.replaceState;

  const finishLocation = () => {
    queueMicrotask(() => afterLocation(new URL(window.location.href)));
  };

  const guardedPushState: History["pushState"] = function (data, unused, url) {
    beforeLocation(resolveHistoryUrl(url));
    const result = originalPushState.call(window.history, data, unused, url);
    finishLocation();
    return result;
  };
  const guardedReplaceState: History["replaceState"] = function (data, unused, url) {
    beforeLocation(resolveHistoryUrl(url));
    const result = originalReplaceState.call(window.history, data, unused, url);
    finishLocation();
    return result;
  };
  const handleBrowserNavigation = () => {
    beforeLocation(new URL(window.location.href));
    finishLocation();
  };

  window.history.pushState = guardedPushState;
  window.history.replaceState = guardedReplaceState;
  window.addEventListener("popstate", handleBrowserNavigation, true);
  window.addEventListener("hashchange", handleBrowserNavigation, true);

  return () => {
    if (window.history.pushState === guardedPushState) {
      window.history.pushState = originalPushState;
    }
    if (window.history.replaceState === guardedReplaceState) {
      window.history.replaceState = originalReplaceState;
    }
    window.removeEventListener("popstate", handleBrowserNavigation, true);
    window.removeEventListener("hashchange", handleBrowserNavigation, true);
  };
}

export function AnalyticsRuntimeController({
  production,
}: Readonly<{
  production: boolean;
}>) {
  const [ready, setReady] = useState(false);
  const tagLoaded = useRef(false);
  const lastPageView = useRef<string | null>(null);

  useLayoutEffect(() => {
    let active = true;
    const prepareLocation = (url: URL) => {
      applyGa4LocationPolicy(url, production, false);
    };
    const settleLocation = (url: URL) => {
      if (!active) return;
      const state = applyGa4LocationPolicy(url, production, tagLoaded.current);
      if (state.policy !== "public" || !tagLoaded.current) return;

      const pageLocation = new URL(url.pathname || "/", url.origin).href;
      if (lastPageView.current === pageLocation) return;
      lastPageView.current = pageLocation;
      sendControlledGaEvent("page_view", {
        page_location: pageLocation,
        page_referrer: "",
        ...(state.debugMode ? { debug_mode: true } : {}),
      });
    };

    prepareLocation(new URL(window.location.href));
    if (!production) return;
    const restoreDataLayer = initializeGa4DataLayer();

    const handleScriptLoad = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLScriptElement && target.id === "_next-ga") {
        tagLoaded.current = true;
        document.documentElement.dataset.ga4Loaded = "true";
        settleLocation(new URL(window.location.href));
      }
    };
    document.addEventListener("load", handleScriptLoad, true);
    const removeHistoryGuard = installGa4HistoryGuard(
      prepareLocation,
      settleLocation,
    );
    queueMicrotask(() => {
      if (active) setReady(true);
    });

    return () => {
      active = false;
      restoreDataLayer();
      removeHistoryGuard();
      document.removeEventListener("load", handleScriptLoad, true);
      document.documentElement.removeAttribute("data-ga4-enabled");
      document.documentElement.removeAttribute("data-ga4-private-commerce");
      document.documentElement.removeAttribute("data-ga4-private-purchase");
      document.documentElement.removeAttribute("data-ga4-loaded");
      tagLoaded.current = false;
      lastPageView.current = null;
      setCollectionDisabled(true);
    };
  }, [production]);

  return production && ready
    ? <GoogleAnalytics gaId={GA4_MEASUREMENT_ID} />
    : null;
}
