"use client";

export type ThirdPartyTransport = "ga4" | "google-ads" | "meta";
const ACTION_EVENT = "rnr:third-party-transport-required";

export function requestThirdPartyTransport(transport: ThirdPartyTransport): void {
  window.dispatchEvent(new CustomEvent(ACTION_EVENT, { detail: transport }));
}

export function isMeaningfulAnalyticsAction(event: string): boolean {
  return ["add_to_cart", "begin_checkout", "add_shipping_info", "add_payment_info", "purchase", "generate_lead", "messenger_click"].includes(event);
}

// Only transports wait. First-party capture, dataLayer/fbq queues and CAPI do not.
export function deferThirdPartyTransport(transport: ThirdPartyTransport, activate: () => void): () => void {
  const minimumMs = transport === "ga4" ? 1000 : 4000;
  const fallbackMs = transport === "ga4" ? 1500 : 5000;
  let finished = false;
  let idle: number | undefined;
  let minimumTimer: number | undefined;
  let fallbackTimer: number | undefined;
  const cleanup = () => {
    window.removeEventListener("load", afterLoad);
    window.removeEventListener(ACTION_EVENT, handleAction);
    if (minimumTimer !== undefined) window.clearTimeout(minimumTimer);
    if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer);
    if (idle !== undefined && typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(idle);
  };
  const start = () => {
    if (finished) return;
    finished = true;
    cleanup();
    activate();
  };
  const handleAction = (event: Event) => {
    if ((event as CustomEvent<ThirdPartyTransport>).detail === transport) start();
  };
  const afterLoad = () => {
    window.removeEventListener("load", afterLoad);
    const navigation = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
    const loadedAt = navigation?.loadEventEnd || navigation?.loadEventStart;
    const elapsed = loadedAt ? Math.max(0, performance.now() - loadedAt) : 0;
    fallbackTimer = window.setTimeout(start, Math.max(0, fallbackMs - elapsed));
    minimumTimer = window.setTimeout(() => {
      if (!finished && typeof window.requestIdleCallback === "function") {
        idle = window.requestIdleCallback(start, { timeout: Math.max(0, fallbackMs - Math.max(minimumMs, elapsed)) });
      }
    }, Math.max(0, minimumMs - elapsed));
  };
  window.addEventListener(ACTION_EVENT, handleAction);
  if (document.readyState === "complete") afterLoad();
  else window.addEventListener("load", afterLoad, { once: true });
  return () => { finished = true; cleanup(); };
}
