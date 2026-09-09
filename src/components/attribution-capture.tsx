"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { captureAttributionHistory, clearAttributionHistory, readAttributionHistory, consentedAttributionHistory, attributionHistoryKey } from "@/domain/analytics/attribution-history";
import { useAdvertisingConsent } from "./consent-preferences";
import { parseAttribution, saveAttribution } from "@/domain/analytics/attribution";

export function AttributionCapture({ customerId }: Readonly<{ customerId: string | null }>) {
  const consent = useAdvertisingConsent();
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? "";
  const initialLanding = useRef<{ url: string; referrer: string; now: Date } | null>(null);
  const historyEntry = useRef<{ url: string; customerId: string | null; consent: string } | null>(null);
  useEffect(() => {
    initialLanding.current ??= { url: window.location.href, referrer: document.referrer, now: new Date() };
    if (!consent) return;
    const url = window.location.href;
    const previous = historyEntry.current;
    const consentKey = `${consent.analytics}:${consent.advertising}`;
    if (previous?.url === url && previous.customerId !== customerId) {
      historyEntry.current = { url, customerId, consent: consentKey };
      if (!consent.analytics) clearAttributionHistory(window.localStorage, customerId);
      else if (!consent.advertising) {
        const saved = readAttributionHistory(window.localStorage, customerId);
        if (saved) {
          try { window.localStorage.setItem(attributionHistoryKey(customerId), JSON.stringify(consentedAttributionHistory(saved, false))); } catch { /* Storage can be disabled. */ }
        }
      }
      return;
    }
    if (previous?.url === url && previous.consent === consentKey) return;
    if (!previous) captureAttributionHistory(window.localStorage, customerId, { ...initialLanding.current, consent });
    if (previous || initialLanding.current.url !== url) {
      captureAttributionHistory(window.localStorage, customerId, { url,
        referrer: previous?.url !== url ? previous?.url ?? initialLanding.current.url : document.referrer,
        now: new Date(), consent });
    }
    historyEntry.current = { url, customerId, consent: consentKey };
  }, [customerId, consent, pathname, search]);
  const capturedUrl = useRef<string | null>(null);
  useEffect(() => {
    const url = `${window.location.pathname}${window.location.search}`;
    if (capturedUrl.current === url) return;
    capturedUrl.current = url;
    const attribution = parseAttribution(new URLSearchParams(window.location.search));
    if (attribution) saveAttribution(window.sessionStorage, customerId, attribution);
  }, [customerId, pathname, search]);
  return null;
}
