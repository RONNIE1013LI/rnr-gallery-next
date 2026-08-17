"use client";

import { useEffect } from "react";
import { emitAnalyticsEvent } from "@/domain/analytics/client";
import type { PurchaseEvent } from "@/domain/analytics/events";

const RETRY_DELAY_MS = 250;
const MAX_ATTEMPTS = 20;

export function PurchaseTracker({ event }: Readonly<{ event: PurchaseEvent | null }>) {
  useEffect(() => {
    if (!event) return;
    const key = `rnr:analytics:v1:purchase:${encodeURIComponent(event.transaction_id)}`;
    if (window.sessionStorage.getItem(key) === "sent") return;

    let cancelled = false;
    let timeout: number | undefined;
    let attempts = 0;
    const tryEmit = () => {
      if (cancelled || window.sessionStorage.getItem(key) === "sent") return;
      attempts += 1;
      if (emitAnalyticsEvent(event)) {
        window.sessionStorage.setItem(key, "sent");
        return;
      }
      if (attempts < MAX_ATTEMPTS) {
        timeout = window.setTimeout(tryEmit, RETRY_DELAY_MS);
      }
    };

    tryEmit();
    return () => {
      cancelled = true;
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [event]);
  return null;
}
