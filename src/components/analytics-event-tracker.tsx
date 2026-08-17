"use client";

import { useEffect, useRef } from "react";
import { emitAnalyticsEvent } from "@/domain/analytics/client";
import type { AnalyticsEvent } from "@/domain/analytics/events";

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
    if (emitAnalyticsEvent(event)) lastEvent.current = signature;
  }, [event, scopeKey]);

  return null;
}
