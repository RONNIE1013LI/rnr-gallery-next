"use client";

const MAX_DEFER_MS = 2_500;
const TIMEOUT_FALLBACK_MS = 250;
const INTERACTIONS = ["pointerdown", "touchstart", "keydown"] as const;

// Call after hydration. Only the external transport waits; queues stay available.
export function deferThirdPartyTransport(activate: () => void): () => void {
  let finished = false;
  let idle: number | undefined;
  let timer: number | undefined;
  const cleanup = () => {
    window.removeEventListener("load", afterLoad);
    for (const event of INTERACTIONS) window.removeEventListener(event, start, true);
    if (timer !== undefined) window.clearTimeout(timer);
    if (idle !== undefined && typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(idle);
    }
  };
  const start = () => {
    if (finished) return;
    finished = true;
    cleanup();
    activate();
  };
  const afterLoad = () => {
    window.removeEventListener("load", afterLoad);
    const navigation = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
    const elapsed = navigation?.loadEventEnd
      ? Math.max(0, performance.now() - navigation.loadEventEnd)
      : 0;
    const remaining = Math.max(0, MAX_DEFER_MS - elapsed);
    if (typeof window.requestIdleCallback === "function") {
      timer = window.setTimeout(start, remaining);
      idle = window.requestIdleCallback(start, { timeout: remaining });
    } else {
      timer = window.setTimeout(start, Math.min(TIMEOUT_FALLBACK_MS, remaining));
    }
  };
  for (const event of INTERACTIONS) {
    window.addEventListener(event, start, { capture: true, passive: true });
  }
  if (document.readyState === "complete") afterLoad();
  else window.addEventListener("load", afterLoad, { once: true });
  return () => {
    finished = true;
    cleanup();
  };
}
