"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { WEBSITE_CLICK_ID_TYPES } from "@/domain/analytics/website-analytics";
import { isTrackableWebsitePath } from "@/domain/analytics/website-path-policy";
import { useAdvertisingConsent } from "./consent-preferences";

function externalReferrerOrigin(): string | null {
  try {
    if (!document.referrer) return null;
    const referrer = new URL(document.referrer);
    return referrer.origin === window.location.origin ? null : referrer.origin;
  } catch {
    return null;
  }
}

export function WebsiteAnalyticsTracker({ enabled }: Readonly<{ enabled: boolean }>) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const consent = useAdvertisingConsent();
  const lastLocation = useRef<string | null>(null);
  const referrerOrigin = useRef<string | null>(null);

  useEffect(() => {
    referrerOrigin.current = externalReferrerOrigin();
  }, []);

  useEffect(() => {
    if (!enabled || !consent?.analytics || !isTrackableWebsitePath(pathname)) {
      if (!consent?.analytics) lastLocation.current = null;
      return;
    }
    const locationKey = `${pathname}?${search}`;
    if (lastLocation.current === locationKey) return;
    lastLocation.current = locationKey;

    const params = new URLSearchParams(search);
    const clickIdTypes = consent.advertising
      ? WEBSITE_CLICK_ID_TYPES.filter((key) => params.has(key))
      : [];
    const body = {
      version: 1,
      eventId: window.crypto.randomUUID(),
      pathname,
      utmSource: params.get("utm_source"),
      utmMedium: params.get("utm_medium"),
      utmCampaign: params.get("utm_campaign"),
      clickIdTypes,
      referrerOrigin: referrerOrigin.current,
    };

    void fetch("/api/analytics/pageview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
      keepalive: true,
    }).catch(() => undefined);
  }, [consent?.advertising, consent?.analytics, enabled, pathname, search]);

  return null;
}
