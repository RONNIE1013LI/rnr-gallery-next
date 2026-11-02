"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { getCartSnapshot, subscribeToCart } from "@/domain/cart/browser-cart-events";
import { parseStoredCart } from "@/domain/cart/browser-cart-repository";
import { cartSnapshotPayload } from "@/domain/analytics/cart-snapshot";
import { useAdvertisingConsent } from "./consent-preferences";

/** Best effort only: analytics errors never block cart mutations or checkout. */
export function CartSnapshotTracker({ enabled }: Readonly<{ enabled: boolean }>) {
  const pathname = usePathname();
  const consent = useAdvertisingConsent();
  const lastSent = useRef<string | null>(null);
  const seenNonempty = useRef(false);
  const lastCurrency = useRef<"NZD" | "AUD" | undefined>(undefined);

  useEffect(() => {
    if (!enabled || consent?.analytics !== true) {
      lastSent.current = null;
      return;
    }
    let active = true;
    let busy = false;
    let queued = false;
    const stage = /^\/(?:au\/)?checkout(?:\/|$)/.test(pathname) ? "checkout" : "cart";
    const send = async () => {
      if (!active) return;
      if (busy) { queued = true; return; }
      busy = true;
      try {
        do {
          queued = false;
          let payload;
          try {
            const cart = parseStoredCart(getCartSnapshot());
            if (cart.items.length === 0 && !seenNonempty.current) break;
            if (cart.items.length > 0) seenNonempty.current = true;
            payload = cartSnapshotPayload(cart, lastCurrency.current ?? (pathname.startsWith("/au/") ? "AUD" : "NZD"));
          } catch { break; }
          if (!payload) break;
          lastCurrency.current = payload.currency;
          const signature = JSON.stringify({ stage, ...payload });
          if (signature === lastSent.current) continue;
          try {
            const response = await fetch("/api/analytics/cart-snapshot", {
              method: "POST",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...payload, stage, eventId: crypto.randomUUID() }),
              keepalive: true,
            });
            if (response.ok && active) lastSent.current = signature;
          } catch {
            // Analytics is strictly non-blocking.
          }
        } while (queued && active);
      } finally { busy = false; }
    };
    const unsubscribe = subscribeToCart(() => { void send(); });
    // The pageview endpoint first issues the signed visitor/session cookies.
    // This follow-up also recovers a 409 caused by an initial pageview race.
    window.addEventListener("rnr:website-analytics:pageview-complete", send);
    void send();
    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener("rnr:website-analytics:pageview-complete", send);
    };
  }, [enabled, consent?.analytics, pathname]);
  return null;
}
