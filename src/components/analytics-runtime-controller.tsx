"use client";

import { GoogleAnalytics } from "@next/third-parties/google";
import Script from "next/script";
import { useLayoutEffect, useRef, useState } from "react";
import {
  beginGaHistorySuppression,
  endGaHistorySuppression,
  markGaTransportReady,
  resetGaTransport,
  sendControlledGaEvent,
  suppressGaCollection,
} from "@/domain/analytics/client";
import {
  classifyGa4Location,
  GA4_DEBUG_SESSION_KEY,
  GA4_DISABLE_WINDOW_KEY,
  GA4_MEASUREMENT_ID,
  GOOGLE_ADS_TAG_ID,
  type Ga4LocationPolicy,
} from "@/domain/analytics/runtime";
import { useAdvertisingConsent } from "./consent-preferences";

type Ga4Window = Window & Record<string, unknown>;

const GA4_HISTORY_SUPPRESSION_MS = 1_100;
const GA4_TAG_READY_POLL_MS = 50;
const GA4_TAG_READY_TIMEOUT_MS = 5_000;

function googleConsentSignals(analytics: boolean, advertising: boolean) {
  return {
    analytics_storage: analytics ? "granted" : "denied",
    ad_storage: advertising ? "granted" : "denied",
    ad_user_data: advertising ? "granted" : "denied",
    ad_personalization: advertising ? "granted" : "denied",
  } as const;
}

function initializeGoogleDataLayer(analytics: boolean, advertising: boolean): () => void {
  const gaWindow = window as Ga4Window & { dataLayer?: unknown[] };
  const dataLayer = Array.isArray(gaWindow.dataLayer) ? gaWindow.dataLayer : [];
  gaWindow.dataLayer = dataLayer;
  const originalPush = dataLayer.push;
  const guardedPush: typeof dataLayer.push = (...commands) => originalPush.apply(
    dataLayer,
    commands.map((command) => {
      const values = Array.from(command as ArrayLike<unknown>);
      if (values[0] !== "config"
        || ![GA4_MEASUREMENT_ID, GOOGLE_ADS_TAG_ID].includes(String(values[1]))) {
        return command;
      }
      const options = values[2] !== null
        && typeof values[2] === "object"
        && !Array.isArray(values[2])
        ? values[2] as Record<string, unknown>
        : {};
      return ["config", values[1], { ...options, send_page_view: false }];
    }),
  );
  dataLayer.push = guardedPush;
  dataLayer.push(["consent", "default", googleConsentSignals(analytics, advertising)]);
  if (analytics) dataLayer.push(["config", GA4_MEASUREMENT_ID, { send_page_view: false }]);
  if (advertising) dataLayer.push(["config", GOOGLE_ADS_TAG_ID, { send_page_view: false }]);

  return () => {
    if (dataLayer.push === guardedPush) dataLayer.push = originalPush;
  };
}

function requestGa4TagReady(onReady: () => void): boolean {
  const gaWindow = window as Ga4Window & {
    gtag?: (...args: unknown[]) => void;
  };
  const gtag = gaWindow.gtag;
  if (typeof gtag !== "function") return false;
  let callbackReceived = false;
  let callReturned = false;
  gaWindow[GA4_DISABLE_WINDOW_KEY] = false;
  try {
    gtag("get", GA4_MEASUREMENT_ID, "client_id", () => {
      callbackReceived = true;
      if (callReturned) onReady();
    });
  } finally {
    gaWindow[GA4_DISABLE_WINDOW_KEY] = true;
    callReturned = true;
  }
  if (callbackReceived) onReady();
  return true;
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

function storedDebugMode(): boolean {
  try {
    return window.sessionStorage.getItem(GA4_DEBUG_SESSION_KEY) === "true";
  } catch {
    return false;
  }
}

export function applyGa4LocationPolicy(
  url: URL,
  production: boolean,
  analyticsAllowed: boolean,
  advertisingAllowed: boolean,
  collectionReady = true,
): Readonly<{ debugMode: boolean; policy: Ga4LocationPolicy }> {
  const root = document.documentElement;
  const policy = classifyGa4Location(url.pathname, url.searchParams);

  if (!production) {
    root.removeAttribute("data-ga4-enabled");
    root.removeAttribute("data-ga4-private-commerce");
    root.removeAttribute("data-ga4-private-purchase");
    root.removeAttribute("data-ga4-loaded");
    root.removeAttribute("data-ga4-analytics-enabled");
    root.removeAttribute("data-google-ads-enabled");
    suppressGaCollection();
    return { debugMode: false, policy };
  }

  const debugMode = controlledDebugMode(url);
  if (analyticsAllowed && collectionReady) {
    root.dataset.ga4AnalyticsEnabled = "true";
  } else {
    root.removeAttribute("data-ga4-analytics-enabled");
  }
  if (advertisingAllowed && collectionReady) {
    root.dataset.googleAdsEnabled = "true";
  } else {
    root.removeAttribute("data-google-ads-enabled");
  }
  if (policy === "public") {
    root.removeAttribute("data-ga4-private-commerce");
    root.removeAttribute("data-ga4-private-purchase");
    if (analyticsAllowed && collectionReady) {
      root.dataset.ga4Enabled = "true";
      suppressGaCollection();
    } else {
      root.removeAttribute("data-ga4-enabled");
      suppressGaCollection();
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
    suppressGaCollection();
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
  const pendingLocationTimers = new Set<number>();

  const finishLocation = (url: URL) => {
    const timer = window.setTimeout(() => {
      pendingLocationTimers.delete(timer);
      afterLocation(url);
    }, GA4_HISTORY_SUPPRESSION_MS);
    pendingLocationTimers.add(timer);
  };

  const guardedPushState: History["pushState"] = function (data, unused, url) {
    beforeLocation(resolveHistoryUrl(url));
    const result = originalPushState.call(window.history, data, unused, url);
    finishLocation(new URL(window.location.href));
    return result;
  };
  const guardedReplaceState: History["replaceState"] = function (data, unused, url) {
    beforeLocation(resolveHistoryUrl(url));
    const result = originalReplaceState.call(window.history, data, unused, url);
    finishLocation(new URL(window.location.href));
    return result;
  };
  const handleBrowserNavigation = () => {
    beforeLocation(new URL(window.location.href));
    finishLocation(new URL(window.location.href));
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
    for (const timer of pendingLocationTimers) window.clearTimeout(timer);
    pendingLocationTimers.clear();
  };
}

export function AnalyticsRuntimeController({
  production,
}: Readonly<{
  production: boolean;
}>) {
  const consent = useAdvertisingConsent();
  const analyticsAllowed = consent?.analytics === true;
  const advertisingAllowed = consent?.advertising === true;
  const googleAllowed = production && (analyticsAllowed || advertisingAllowed);
  const [ready, setReady] = useState(false);
  const tagLoaded = useRef(false);
  const lastPageView = useRef<string | null>(null);

  useLayoutEffect(() => {
    let active = true;
    const prepareLocation = (url: URL) => {
      applyGa4LocationPolicy(url, googleAllowed, analyticsAllowed, advertisingAllowed, false);
    };
    const settleLocation = (url: URL) => {
      if (!active) return;
      const currentUrl = new URL(window.location.href);
      const isCurrentLocation = currentUrl.href === url.href;
      const state = isCurrentLocation
        ? applyGa4LocationPolicy(
          url,
          googleAllowed,
          analyticsAllowed,
          advertisingAllowed,
          tagLoaded.current,
        )
        : {
          debugMode: storedDebugMode(),
          policy: classifyGa4Location(url.pathname, url.searchParams),
        };
      if (!analyticsAllowed || state.policy !== "public" || !tagLoaded.current) return;

      const pageLocation = new URL(url.pathname || "/", url.origin).href;
      if (lastPageView.current === pageLocation) return;
      lastPageView.current = pageLocation;
      sendControlledGaEvent("page_view", {
        page_location: pageLocation,
        page_referrer: "",
        ...(state.debugMode ? { debug_mode: true } : {}),
      });
    };
    const prepareHistoryLocation = (url: URL) => {
      beginGaHistorySuppression();
      prepareLocation(url);
    };
    const settleHistoryLocation = (url: URL) => {
      try {
        settleLocation(url);
      } finally {
        endGaHistorySuppression();
      }
    };

    prepareLocation(new URL(window.location.href));
    if (!googleAllowed) {
      queueMicrotask(() => {
        if (active) setReady(false);
      });
      return;
    }
    resetGaTransport();
    const restoreDataLayer = initializeGoogleDataLayer(analyticsAllowed, advertisingAllowed);
    let tagReadyPoll: number | undefined;
    let tagReadyTimeout: number | undefined;

    const stopTagReadyCheck = () => {
      if (tagReadyPoll !== undefined) window.clearInterval(tagReadyPoll);
      if (tagReadyTimeout !== undefined) window.clearTimeout(tagReadyTimeout);
      tagReadyPoll = undefined;
      tagReadyTimeout = undefined;
    };
    const acceptReadyTag = () => {
      if (!active || tagReadyTimeout === undefined) return;
      stopTagReadyCheck();
      markGaTransportReady();
    };
    const requestReadyProbe = () => {
      if (active) requestGa4TagReady(acceptReadyTag);
    };

    const handleScriptLoad = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLScriptElement
        && (target.id === "_next-ga" || target.id === "rnr-google-ads")) {
        tagLoaded.current = true;
        document.documentElement.dataset.ga4Loaded = "true";
        settleLocation(new URL(window.location.href));
        if (!analyticsAllowed) {
          markGaTransportReady();
          return;
        }
        tagReadyTimeout = window.setTimeout(() => {
          stopTagReadyCheck();
          tagLoaded.current = false;
          document.documentElement.removeAttribute("data-ga4-loaded");
          applyGa4LocationPolicy(
            new URL(window.location.href),
            googleAllowed,
            analyticsAllowed,
            advertisingAllowed,
            false,
          );
          resetGaTransport();
        }, GA4_TAG_READY_TIMEOUT_MS);
        tagReadyPoll = window.setInterval(requestReadyProbe, GA4_TAG_READY_POLL_MS);
        requestReadyProbe();
      }
    };
    document.addEventListener("load", handleScriptLoad, true);
    const removeHistoryGuard = installGa4HistoryGuard(
      prepareHistoryLocation,
      settleHistoryLocation,
    );
    queueMicrotask(() => {
      if (active) setReady(true);
    });

    return () => {
      active = false;
      stopTagReadyCheck();
      restoreDataLayer();
      const dataLayer = (window as Ga4Window & { dataLayer?: unknown[] }).dataLayer;
      if (Array.isArray(dataLayer)) {
        dataLayer.push(["consent", "update", googleConsentSignals(false, false)]);
      }
      removeHistoryGuard();
      document.removeEventListener("load", handleScriptLoad, true);
      document.documentElement.removeAttribute("data-ga4-enabled");
      document.documentElement.removeAttribute("data-ga4-private-commerce");
      document.documentElement.removeAttribute("data-ga4-private-purchase");
      document.documentElement.removeAttribute("data-ga4-loaded");
      document.documentElement.removeAttribute("data-ga4-analytics-enabled");
      document.documentElement.removeAttribute("data-google-ads-enabled");
      tagLoaded.current = false;
      lastPageView.current = null;
      resetGaTransport();
    };
  }, [advertisingAllowed, analyticsAllowed, googleAllowed]);

  if (!googleAllowed || !ready) return null;
  if (analyticsAllowed) return <GoogleAnalytics gaId={GA4_MEASUREMENT_ID} />;
  return <Script
    id="rnr-google-ads"
    src={`https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ADS_TAG_ID}`}
    strategy="afterInteractive"
  />;
}
