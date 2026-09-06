import { ADVERTISING_CONSENT_COOKIE, parseAdvertisingConsent } from "@/domain/consent/advertising-consent";
import { parseWebsiteAnalyticsSession, parseWebsiteAnalyticsInternalDevice, parseWebsiteAnalyticsVisitor, WEBSITE_ANALYTICS_INTERNAL_COOKIE, WEBSITE_ANALYTICS_SESSION_COOKIE, WEBSITE_ANALYTICS_VISITOR_COOKIE, websiteAnalyticsVisitorDigest } from "./website-analytics-cookies";
import type { WebsiteAnalyticsRuntimeConfig } from "./website-analytics-config";

export type WebsiteAnalyticsBehavioralContext = Readonly<{
  consentLinked: boolean;
  visitorDigest?: string;
  convertingSessionId?: string;
  isInternal?: boolean;
}>;

function cookieValue(header: string | null, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator >= 0 && part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
}

export function resolveWebsiteAnalyticsBehavioralContext(
  cookieHeader: string | null,
  config: WebsiteAnalyticsRuntimeConfig,
  now = new Date(),
): WebsiteAnalyticsBehavioralContext {
  if (!config.v2Enabled || !config.enabled || !config.cookieSecret) {
    return Object.freeze({ consentLinked: false, isInternal: false });
  }
  const isInternal = parseWebsiteAnalyticsInternalDevice(
    cookieValue(cookieHeader, WEBSITE_ANALYTICS_INTERNAL_COOKIE),
    config.cookieSecret,
    now,
  );
  const consent = parseAdvertisingConsent(cookieValue(cookieHeader, ADVERTISING_CONSENT_COOKIE));
  if (!consent?.analytics) return Object.freeze({ consentLinked: false, isInternal });
  const visitor = parseWebsiteAnalyticsVisitor(
    cookieValue(cookieHeader, WEBSITE_ANALYTICS_VISITOR_COOKIE),
    config.cookieSecret,
    now,
  );
  const session = parseWebsiteAnalyticsSession(
    cookieValue(cookieHeader, WEBSITE_ANALYTICS_SESSION_COOKIE),
    config.cookieSecret,
    now,
  );
  if (!visitor || !session) return Object.freeze({ consentLinked: false, isInternal });
  return Object.freeze({
    consentLinked: true,
    visitorDigest: websiteAnalyticsVisitorDigest(visitor.visitorId, config.cookieSecret),
    convertingSessionId: session.sessionId,
    isInternal,
  });
}

