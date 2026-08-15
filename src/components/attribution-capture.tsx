"use client";

import { useEffect, useRef } from "react";
import { parseAttribution, saveAttribution } from "@/domain/analytics/attribution";

export function AttributionCapture({ customerId }: Readonly<{ customerId: string | null }>) {
  const capturedUrl = useRef<string | null>(null);
  useEffect(() => {
    const url = `${window.location.pathname}${window.location.search}`;
    if (capturedUrl.current === url) return;
    capturedUrl.current = url;
    const attribution = parseAttribution(new URLSearchParams(window.location.search));
    if (attribution) saveAttribution(window.sessionStorage, customerId, attribution);
  });
  return null;
}
