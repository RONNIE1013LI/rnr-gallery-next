"use client";

import { sendGAEvent } from "@next/third-parties/google";
import type { AnalyticsEvent } from "./events";
import { GA4_DEBUG_SESSION_KEY } from "./runtime";

function isDebugSession(): boolean {
  const control = new URLSearchParams(window.location.search).get("ga_debug");
  if (control === "1") {
    window.sessionStorage.setItem(GA4_DEBUG_SESSION_KEY, "true");
  } else if (control === "0") {
    window.sessionStorage.removeItem(GA4_DEBUG_SESSION_KEY);
  }
  return window.sessionStorage.getItem(GA4_DEBUG_SESSION_KEY) === "true";
}

export function emitAnalyticsEvent(event: AnalyticsEvent | null): boolean {
  if (
    !event
    || typeof document === "undefined"
    || document.documentElement.dataset.ga4Enabled !== "true"
  ) {
    return false;
  }

  const { event: eventName, ...payload } = event;
  sendGAEvent("event", eventName, {
    ...payload,
    ...(isDebugSession() ? { debug_mode: true } : {}),
  });
  return true;
}
