import { parseAdvertisingConsent, ADVERTISING_CONSENT_COOKIE } from "@/domain/consent/advertising-consent";
import { classifyWebsiteAttribution } from "@/domain/analytics/website-attribution";
import { normalizeCountryCode } from "@/domain/analytics/website-analytics";
import { isTrackableWebsitePath, normalizeWebsitePathname } from "@/domain/analytics/website-path-policy";
import {
  createWebsiteAnalyticsSession,
  createWebsiteAnalyticsVisitor,
  parseWebsiteAnalyticsInternalDevice,
  parseWebsiteAnalyticsSession,
  parseWebsiteAnalyticsVisitor,
  renewWebsiteAnalyticsSession,
  WEBSITE_ANALYTICS_SESSION_COOKIE,
  WEBSITE_ANALYTICS_INTERNAL_COOKIE,
  WEBSITE_ANALYTICS_VISITOR_COOKIE,
  websiteAnalyticsCookieHeaders,
  websiteAnalyticsVisitorDigest,
} from "@/server/analytics/website-analytics-cookies";
import {
  readWebsiteAnalyticsConfig,
  type WebsiteAnalyticsConfig,
} from "@/server/analytics/website-analytics-config";
import { websiteAnalyticsLocalDate } from "@/server/analytics/website-local-date";
import {
  recordWebsiteAnalyticsPageview,
  type WebsiteAnalyticsRecord,
} from "@/server/analytics/website-analytics-repository";
import { assertTrustedMutationRequest, parseBoundedJson } from "@/server/http/mutation-request";

const MAX_BODY_BYTES = 4_096;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BOT_USER_AGENT = /(?:bot|crawler|spider|slurp|headless|lighthouse|monitoring|uptime|pingdom)/i;

type Dependencies = Readonly<{
  config?: WebsiteAnalyticsConfig;
  trustedOrigin?: string;
  environment?: string;
  now?: () => Date;
  record?: (input: WebsiteAnalyticsRecord) => Promise<unknown>;
}>;

type Payload = Readonly<{
  eventId: string;
  pathname: string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  clickIdTypes: readonly string[];
  referrerOrigin: string | null;
}>;

function empty(headers?: Headers) {
  const responseHeaders = headers ?? new Headers();
  responseHeaders.set("Cache-Control", "no-store");
  return new Response(null, { status: 204, headers: responseHeaders });
}

function cookieValue(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return undefined;
}

function nullableString(value: unknown, maximum: number): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" && value.length <= maximum ? value : undefined;
}

function parsePayload(input: unknown): Payload | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expected = [
    "clickIdTypes",
    "eventId",
    "pathname",
    "referrerOrigin",
    "utmCampaign",
    "utmMedium",
    "utmSource",
    "version",
  ];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return null;
  if (record.version !== 1 || typeof record.eventId !== "string" || !UUID.test(record.eventId)) return null;
  if (typeof record.pathname !== "string" || record.pathname.length > 1_024) return null;
  const utmSource = nullableString(record.utmSource, 255);
  const utmMedium = nullableString(record.utmMedium, 100);
  const utmCampaign = nullableString(record.utmCampaign, 100);
  const referrerOrigin = nullableString(record.referrerOrigin, 2_048);
  if (utmSource === undefined || utmMedium === undefined
    || utmCampaign === undefined || referrerOrigin === undefined) return null;
  if (!Array.isArray(record.clickIdTypes)
    || record.clickIdTypes.length > 4
    || record.clickIdTypes.some((value) => typeof value !== "string" || value.length > 16)) return null;
  return {
    eventId: record.eventId,
    pathname: record.pathname,
    utmSource,
    utmMedium,
    utmCampaign,
    clickIdTypes: record.clickIdTypes as string[],
    referrerOrigin,
  };
}

export function createWebsitePageviewRoute(dependencies: Dependencies = {}) {
  return async function POST(request: Request) {
    try {
      const config = dependencies.config ?? readWebsiteAnalyticsConfig();
      if (!config.enabled || !config.cookieSecret) return empty();
      assertTrustedMutationRequest(request, dependencies.trustedOrigin);
      const consent = parseAdvertisingConsent(cookieValue(
        request.headers.get("Cookie"),
        ADVERTISING_CONSENT_COOKIE,
      ));
      if (!consent?.analytics || BOT_USER_AGENT.test(request.headers.get("User-Agent") ?? "")) {
        return empty();
      }

      const payload = parsePayload(await parseBoundedJson(request, MAX_BODY_BYTES));
      if (!payload || !isTrackableWebsitePath(payload.pathname)) return empty();
      const pathname = normalizeWebsitePathname(payload.pathname);
      if (!pathname) return empty();

      const now = dependencies.now?.() ?? new Date();
      const cookieHeader = request.headers.get("Cookie");
      const visitorCookie = cookieValue(cookieHeader, WEBSITE_ANALYTICS_VISITOR_COOKIE);
      const sessionCookie = cookieValue(cookieHeader, WEBSITE_ANALYTICS_SESSION_COOKIE);
      const existingVisitor = parseWebsiteAnalyticsVisitor(visitorCookie, config.cookieSecret, now);
      const existingSession = parseWebsiteAnalyticsSession(sessionCookie, config.cookieSecret, now);
      const isInternal = parseWebsiteAnalyticsInternalDevice(
        cookieValue(cookieHeader, WEBSITE_ANALYTICS_INTERNAL_COOKIE),
        config.cookieSecret,
        now,
      );
      const createdVisitor = existingVisitor
        ? null
        : createWebsiteAnalyticsVisitor(config.cookieSecret, now);
      const createdSession = existingSession
        ? null
        : createWebsiteAnalyticsSession(config.cookieSecret, now);
      const visitorId = existingVisitor?.visitorId ?? createdVisitor!.visitorId;
      const sessionId = existingSession?.sessionId ?? createdSession!.sessionId;
      const nextVisitorCookie = existingVisitor ? visitorCookie! : createdVisitor!.visitorCookie;
      const nextSessionCookie = existingSession
        ? renewWebsiteAnalyticsSession(existingSession.sessionId, config.cookieSecret, now)
        : createdSession!.sessionCookie;

      await (dependencies.record ?? recordWebsiteAnalyticsPageview)({
        eventId: payload.eventId,
        sessionId,
        visitorDigest: websiteAnalyticsVisitorDigest(visitorId, config.cookieSecret),
        occurredAt: now,
        localDate: websiteAnalyticsLocalDate(now),
        pathname,
        attribution: classifyWebsiteAttribution({
          advertisingConsent: consent.advertising,
          utmSource: payload.utmSource,
          utmMedium: payload.utmMedium,
          utmCampaign: payload.utmCampaign,
          clickIdTypes: payload.clickIdTypes,
          referrerOrigin: payload.referrerOrigin,
        }),
        countryCode: normalizeCountryCode(request.headers.get("x-vercel-ip-country")),
        isInternal,
      });

      const headers = new Headers();
      for (const cookie of websiteAnalyticsCookieHeaders({
        visitorCookie: nextVisitorCookie,
        sessionCookie: nextSessionCookie,
      }, dependencies.environment ?? process.env.VERCEL_ENV)) headers.append("Set-Cookie", cookie);
      return empty(headers);
    } catch {
      return empty();
    }
  };
}

export const POST = createWebsitePageviewRoute();
