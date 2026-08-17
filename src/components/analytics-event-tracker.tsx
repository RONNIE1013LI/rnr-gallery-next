"use client";

import { useEffect, useRef } from "react";
import { emitAnalyticsEvent } from "@/domain/analytics/client";
import type { AnalyticsEvent } from "@/domain/analytics/events";

const RETRY_DELAY_MS = 250;
const MAX_ATTEMPTS = 20;

export function AnalyticsEventTracker({
  event,
  scopeKey,
}: Readonly<{
  event: AnalyticsEvent | null;
  scopeKey: string;
}>) {
  const lastEvent = useRef<string | null>(null);

  useEffect(() => {
    if (!event) return;
    const signature = `${scopeKey}:${JSON.stringify(event)}`;
    if (lastEvent.current === signature) return;

    let cancelled = false;
    let timeout: number | undefined;
    let attempts = 0;
    const tryEmit = () => {
      if (cancelled || lastEvent.current === signature) return;
      attempts += 1;
      if (emitAnalyticsEvent(event)) {
        lastEvent.current = signature;
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
  }, [event, scopeKey]);

  return null;
}
