"use client";

import { useEffect } from "react";
import { emitAnalyticsEvent } from "@/domain/analytics/client";
import type { PurchaseEvent } from "@/domain/analytics/events";

export function PurchaseTracker({ event }: Readonly<{ event: PurchaseEvent | null }>) {
  useEffect(() => {
    if (!event) return;
    const key = `rnr:analytics:v1:purchase:${encodeURIComponent(event.transaction_id)}`;
    if (window.sessionStorage.getItem(key) === "sent") return;
    if (emitAnalyticsEvent(event)) window.sessionStorage.setItem(key, "sent");
  }, [event]);
  return null;
}
