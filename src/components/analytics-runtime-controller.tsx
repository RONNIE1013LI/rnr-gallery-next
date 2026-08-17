"use client";

import { GoogleAnalytics } from "@next/third-parties/google";
import { useLayoutEffect, useState } from "react";
import {
  classifyGa4Location,
  GA4_DEBUG_SESSION_KEY,
  GA4_DISABLE_WINDOW_KEY,
  GA4_MEASUREMENT_ID,
  type Ga4LocationPolicy,
} from "@/domain/analytics/runtime";

type Ga4Window = Window & Record<string, unknown>;

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
): Readonly<{ debugMode: boolean; policy: Ga4LocationPolicy }> {
  const root = document.documentElement;
  const policy = classifyGa4Location(url.pathname, url.searchParams);

  if (!production) {
    root.removeAttribute("data-ga4-enabled");
    root.removeAttribute("data-ga4-private-purchase");
    root.removeAttribute("data-ga4-loaded");
    setCollectionDisabled(true);
    return { debugMode: false, policy };
  }

  const debugMode = controlledDebugMode(url);
  if (policy === "public") {
    root.dataset.ga4Enabled = "true";
    root.removeAttribute("data-ga4-private-purchase");
    setCollectionDisabled(false);
  } else {
    root.removeAttribute("data-ga4-enabled");
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

export function installGa4HistoryGuard(onLocation: (url: URL) => void): () => void {
  const originalPushState = window.history.pushState;
  const originalReplaceState = window.history.replaceState;

  const guardedPushState: History["pushState"] = function (data, unused, url) {
    onLocation(resolveHistoryUrl(url));
    return originalPushState.call(window.history, data, unused, url);
  };
  const guardedReplaceState: History["replaceState"] = function (data, unused, url) {
    onLocation(resolveHistoryUrl(url));
    return originalReplaceState.call(window.history, data, unused, url);
  };
  const handleBrowserNavigation = () => onLocation(new URL(window.location.href));

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
  const [debugMode, setDebugMode] = useState(false);

  useLayoutEffect(() => {
    const updateLocation = (url: URL) => {
      const state = applyGa4LocationPolicy(url, production);
      setDebugMode(state.debugMode);
    };

    updateLocation(new URL(window.location.href));
    if (!production) return;

    const handleScriptLoad = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLScriptElement && target.id === "_next-ga") {
        document.documentElement.dataset.ga4Loaded = "true";
      }
    };
    document.addEventListener("load", handleScriptLoad, true);
    const removeHistoryGuard = installGa4HistoryGuard(updateLocation);
    let active = true;
    queueMicrotask(() => {
      if (active) setReady(true);
    });

    return () => {
      active = false;
      removeHistoryGuard();
      document.removeEventListener("load", handleScriptLoad, true);
      document.documentElement.removeAttribute("data-ga4-enabled");
      document.documentElement.removeAttribute("data-ga4-private-purchase");
      setCollectionDisabled(true);
    };
  }, [production]);

  return production && ready
    ? <GoogleAnalytics gaId={GA4_MEASUREMENT_ID} debugMode={debugMode} />
    : null;
}
