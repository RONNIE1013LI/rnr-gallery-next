"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { captureAttributionHistory, clearAttributionHistory, readAttributionHistory, consentedAttributionHistory, attributionHistoryKey } from "@/domain/analytics/attribution-history";
import { useAdvertisingConsent } from "./consent-preferences";
import { clearAttribution, parseAttribution, readAttribution, saveAttribution } from "@/domain/analytics/attribution";

export function AttributionCapture({ customerId }: Readonly<{ customerId: string | null }>) {
  const consent = useAdvertisingConsent();
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? "";
  const initialLanding = useRef<{ url: string; referrer: string; now: Date } | null>(null);
  const historyEntry = useRef<{ url: string; customerId: string | null; consent: string } | null>(null);
  const attributionLanding = useRef<{
    url: string; customerId: string | null; now: Date; oppref?: string; opprefCapturedAt?: string | null;
  } | null>(null);
  useEffect(() => {
    initialLanding.current ??= { url: window.location.href, referrer: document.referrer, now: new Date() };
    if (!consent) return;
    const url = window.location.href;
    const previous = historyEntry.current;
    const consentKey = `${consent.analytics}:${consent.advertising}`;
    const openAICaptureTime = (landingUrl: string) => {
      const oppref = parseAttribution(new URL(landingUrl).searchParams)?.oppref;
      const saved = readAttribution(window.sessionStorage, customerId);
      if (oppref && saved?.oppref === oppref) return saved.opprefCapturedAt ?? null;
      const landing = attributionLanding.current;
      return oppref && landing?.customerId === customerId && landing.oppref === oppref
        ? landing.opprefCapturedAt : undefined;
    };
    if ((previous?.url === url && previous.customerId !== customerId)
      || (attributionLanding.current?.url === `${window.location.pathname}${window.location.search}`
        && attributionLanding.current.customerId !== customerId)) {
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
    if (!previous) captureAttributionHistory(window.localStorage, customerId, { ...initialLanding.current, consent,
      opprefCapturedAt: openAICaptureTime(initialLanding.current.url) });
    if (previous || initialLanding.current.url !== url) {
      captureAttributionHistory(window.localStorage, customerId, { url,
        referrer: previous?.url !== url ? previous?.url ?? initialLanding.current.url : document.referrer,
        now: new Date(), consent, opprefCapturedAt: openAICaptureTime(url) });
    }
    historyEntry.current = { url, customerId, consent: consentKey };
  }, [customerId, consent, pathname, search]);
  const capturedUrl = useRef<string | null>(null);
  useEffect(() => {
    const url = `${window.location.pathname}${window.location.search}`;
    if (attributionLanding.current?.url !== url) {
      const now = initialLanding.current?.url === window.location.href ? initialLanding.current.now : new Date();
      const oppref = parseAttribution(new URLSearchParams(window.location.search))?.oppref;
      const saved = readAttribution(window.sessionStorage, customerId);
      const history = readAttributionHistory(window.localStorage, customerId);
      const historicalCaptureTime = [history?.firstTouch, history?.lastNonDirectTouch, history?.lastTouch]
        .filter(touch => oppref && touch?.campaign.oppref === oppref)
        .map(touch => touch!.at).sort((a, b) => Date.parse(a) - Date.parse(b))[0];
      attributionLanding.current = { url, customerId, now, oppref,
        opprefCapturedAt: oppref && saved?.oppref === oppref ? saved.opprefCapturedAt ?? null
          : historicalCaptureTime ?? now.toISOString() };
    }
    const captureKey = `${url}:${customerId ?? "guest"}:${consent?.advertising === true}`;
    if (capturedUrl.current === captureKey) return;
    capturedUrl.current = captureKey;
    if (!consent?.advertising) {
      const saved = readAttribution(window.sessionStorage, customerId);
      if (saved?.oppref) {
        const remaining = { ...saved };
        delete remaining.oppref;
        delete remaining.opprefCapturedAt;
        if (Object.keys(remaining).length) saveAttribution(window.sessionStorage, customerId, remaining);
        else clearAttribution(window.sessionStorage, customerId);
      }
    }
    if (attributionLanding.current.customerId !== customerId) return;
    const attribution = parseAttribution(new URLSearchParams(window.location.search));
    if (attribution) {
      const campaign = { ...attribution };
      if (!consent?.advertising) delete campaign.oppref;
      else if (campaign.oppref) {
        const capturedAt = attributionLanding.current.opprefCapturedAt;
        if (capturedAt) campaign.opprefCapturedAt = capturedAt;
      }
      if (Object.keys(campaign).length) saveAttribution(window.sessionStorage, customerId, campaign);
    }
  }, [customerId, consent?.advertising, pathname, search]);
  return null;
}
