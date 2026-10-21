"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { WEBSITE_CLICK_ID_TYPES } from "@/domain/analytics/website-analytics";
import { isTrackableWebsitePageviewPath, normalizeWebsitePathname } from "@/domain/analytics/website-path-policy";
import { parseAttribution } from "@/domain/analytics/attribution";
import { useAdvertisingConsent, useExplicitAdvertisingConsent } from "./consent-preferences";

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
  const explicitAdvertising = useExplicitAdvertisingConsent();
  const lastLocation = useRef<string | null>(null);
  const referrerOrigin = useRef<string | null>(null);

  useEffect(() => {
    referrerOrigin.current = externalReferrerOrigin();
  }, []);

  useEffect(() => {
    if (explicitAdvertising === null) return;
    if (!enabled || !consent?.analytics || !isTrackableWebsitePageviewPath(pathname)) {
      lastLocation.current = null;
      return;
    }
    const locationKey = normalizeWebsitePathname(pathname);
    if (lastLocation.current === locationKey) return;
    lastLocation.current = locationKey;

    const params = new URLSearchParams(search);
    const clickIdTypes = consent.advertising
      ? WEBSITE_CLICK_ID_TYPES.filter((key) => params.has(key))
      : [];
    const tiktokClick = consent.advertising && explicitAdvertising && clickIdTypes.length === 0
      && Boolean(parseAttribution(params)?.ttclid);
    const body = {
      version: 1,
      eventId: window.crypto.randomUUID(),
      pathname,
      utmSource: tiktokClick ? "tiktok_ads" : params.get("utm_source"),
      utmMedium: tiktokClick ? "paid_click" : params.get("utm_medium"),
      utmCampaign: params.get("utm_campaign"),
      clickIdTypes,
      referrerOrigin: referrerOrigin.current,
    };

    void sendWebsiteAnalyticsPageview(body).catch(() => undefined);
  }, [consent?.advertising, consent?.analytics, explicitAdvertising, enabled, pathname, search]);

  return null;
}
