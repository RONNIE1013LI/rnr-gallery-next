"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { getCartSnapshot, subscribeToCart } from "@/domain/cart/browser-cart-events";
import { getActiveCartStorageKey } from "@/domain/cart/browser-cart-scope";
import { parseStoredCart } from "@/domain/cart/browser-cart-repository";
import { cartSnapshotPayload, type CartSnapshot } from "@/domain/analytics/cart-snapshot";
import { cartAnalyticsReadyAt, subscribeCartAnalyticsReady } from "@/domain/analytics/cart-capture-readiness";
import { isTrackableWebsitePageviewPath } from "@/domain/analytics/website-path-policy";
import { useAdvertisingConsent } from "./consent-preferences";

/** Capture is independent from commerce writes and never awaits or changes checkout. */
export function CartSnapshotTracker({ enabled }: Readonly<{ enabled: boolean }>) {
  const pathname = usePathname();
  const consent = useAdvertisingConsent();
  useEffect(() => {
    if (!enabled || consent?.analytics !== true || !isTrackableWebsitePageviewPath(pathname)) return;
    let active = true;
    let busy = false;
    let signature: string | null = null;
    const queue: { payload: CartSnapshot; scope: string }[] = [];
    const controller = new AbortController();
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const stage = /^\/(?:au\/)?checkout(?:\/|$)/.test(pathname) ? "checkout" : "cart";
    const currency = /^\/au(?:\/|$)/.test(pathname) ? "AUD" : "NZD";
    const pause = (ms: number) => new Promise<void>((resolve) => {
      const timer = setTimeout(() => { timers.delete(timer); resolve(); }, ms);
      timers.add(timer);
      controller.signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
    });
    const drain = async () => {
      if (busy) return;
      busy = true;
      try {
        while (active && queue.length) {
          const next = queue.shift()!;
          for (let attempt = 0; active && attempt < 3; attempt++) {
            if (next.scope !== getActiveCartStorageKey()) break;
            try {
              const response = await fetch("/api/analytics/cart-snapshot", {
                method: "POST", credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(next.payload), signal: controller.signal,
              });
              if (response.ok || (response.status !== 409 && response.status !== 503)) break;
            } catch { if (!active) break; }
            if (attempt < 2) await pause(250 * (attempt + 1));
          }
        }
      } finally { busy = false; }
    };
    const capture = () => {
      if (!active || !cartAnalyticsReadyAt(pathname)) return;
      try {
        const scope = getActiveCartStorageKey();
        const payload = cartSnapshotPayload(parseStoredCart(getCartSnapshot()), currency);
        if (!payload) return;
        const key = JSON.stringify({ scope, stage, ...payload });
        if (signature === key || queue.length >= 20) return;
        signature = key;
        queue.push({ scope, payload: { ...payload, stage, eventId: crypto.randomUUID() } });
        void drain();
      } catch { /* Storage, crypto and analytics failures never affect commerce. */ }
    };
    const unsubscribe = subscribeToCart(capture);
    const unready = subscribeCartAnalyticsReady(capture);
    capture();
    return () => {
      active = false; queue.length = 0; controller.abort();
      timers.forEach(clearTimeout); unsubscribe(); unready();
    };
  }, [enabled, consent?.analytics, pathname]);
  return null;
}
