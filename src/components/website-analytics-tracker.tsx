"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { WEBSITE_CLICK_ID_TYPES } from "@/domain/analytics/website-analytics";
import { isTrackableWebsitePath } from "@/domain/analytics/website-path-policy";
import { useAdvertisingConsent } from "./consent-preferences";

const WEBSITE_ANALYTICS_PAGEVIEW_LOCK = "rnr:website-analytics:pageview";

type WebsiteAnalyticsLockManager = Readonly<{
  request(
    name: string,
    options: Readonly<{ mode: "exclusive" }>,
    callback: () => Promise<void>,
  ): Promise<void>;
}>;

function externalReferrerOrigin(): string | null {
  try {
    if (!document.referrer) return null;
    const referrer = new URL(document.referrer);
    return referrer.origin === window.location.origin ? null : referrer.origin;
  } catch {
    return null;
  }
}

function analyticsLockManager(): WebsiteAnalyticsLockManager | null {
  return (navigator as Navigator & { locks?: WebsiteAnalyticsLockManager }).locks ?? null;
}

function postWebsiteAnalyticsPageview(body: unknown): Promise<Response> {
  return fetch("/api/analytics/pageview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
    keepalive: true,
  });
}

async function sendWebsiteAnalyticsPageview(body: unknown): Promise<void> {
  const send = async () => {
    await postWebsiteAnalyticsPageview(body);
  };
  const locks = analyticsLockManager();
  if (!locks) {
    await send();
    return;
  }

  let callbackStarted = false;
  try {
    await locks.request(WEBSITE_ANALYTICS_PAGEVIEW_LOCK, { mode: "exclusive" }, async () => {
      callbackStarted = true;
      await send();
    });
  } catch {
    if (!callbackStarted) await send();
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

    void sendWebsiteAnalyticsPageview(body).catch(() => undefined);
  }, [consent?.advertising, consent?.analytics, enabled, pathname, search]);

  return null;
}
