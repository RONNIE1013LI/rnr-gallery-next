import {
  ANALYTICS_DIMENSION_SENTINELS,
  WEBSITE_ANALYTICS_V2_RULES_VERSION,
  type WebsiteAnalyticsMarket,
  type WebsiteAnalyticsV2Channel,
} from "@/domain/analytics/website-analytics-v2";
import {
  WEBSITE_CLICK_ID_TYPES,
  type WebsiteAnalyticsChannel,
  type WebsiteClickIdType,
} from "@/domain/analytics/website-analytics";

export type WebsiteAnalyticsDeviceCategory = "desktop" | "mobile" | "tablet" | "other";
export type WebsiteAnalyticsConsentQualifiedClickIds = Readonly<Partial<Record<WebsiteClickIdType, string>>>;

export type WebsiteAnalyticsAttributionSession = Readonly<{
  id: string;
  visitorDigest: string;
  startedAt: Date;
  channel: WebsiteAnalyticsChannel;
  source: string;
  medium: string | null;
  campaign: string | null;
  term?: string | null;
  content?: string | null;
  landingPath?: string | null;
  referrerOrigin?: string | null;
  market?: WebsiteAnalyticsMarket | null;
  countryCode?: string | null;
  deviceCategory?: WebsiteAnalyticsDeviceCategory | null;
  consentQualifiedClickIds?: WebsiteAnalyticsConsentQualifiedClickIds | null;
}>;

export type WebsiteAnalyticsAttributionConversion = Readonly<{
  occurredAt: Date;
  visitorDigest?: string | null;
  convertingSessionId?: string | null;
  consentLinked: boolean;
  source?: "website" | "manual";
  sourceReference?: string | null;
  historical?: boolean;
}>;

export type WebsiteAnalyticsAttributionSnapshot = Readonly<{
  model: "first_touch" | "last_touch";
  sessionId: string | null;
  channel: WebsiteAnalyticsV2Channel;
  source: string;
  medium: string | null;
  campaign: string | null;
  term: string | null;
  content: string | null;
  landingPath: string | null;
  externalReferrerOrigin: string | null;
  market: WebsiteAnalyticsMarket | null;
  countryCode: string | null;
  deviceCategory: WebsiteAnalyticsDeviceCategory | null;
  consentQualifiedClickIds: WebsiteAnalyticsConsentQualifiedClickIds | null;
  attributedAt: string;
  visitorReference: string | null;
  conversionReference: string | null;
  rulesVersion: typeof WEBSITE_ANALYTICS_V2_RULES_VERSION;
}>;

type NormalizedSession = WebsiteAnalyticsAttributionSession & Readonly<{
  channel: WebsiteAnalyticsChannel;
  source: string;
  medium: string | null;
  referrerOrigin: string | null;
}>;

const OWN_HOSTS = new Set([
  "rnrgallery.com",
  "www.rnrgallery.com",
  "rrgallery.co.nz",
  "www.rrgallery.co.nz",
]);

function hasConsentQualifiedClickId(session: WebsiteAnalyticsAttributionSession): boolean {
  return WEBSITE_CLICK_ID_TYPES.some((key) => {
    const identifier = session.consentQualifiedClickIds?.[key];
    return typeof identifier === "string" && identifier.trim().length > 0;
  });
}

function normalizeSession(session: WebsiteAnalyticsAttributionSession): NormalizedSession {
  const exactLegacySelfReferral = session.channel === "other"
    && OWN_HOSTS.has(session.source.trim().toLowerCase())
    && session.medium?.trim().toLowerCase() === "referral"
    && !session.campaign?.trim()
    && !session.term?.trim()
    && !session.content?.trim()
    && !hasConsentQualifiedClickId(session);
  if (exactLegacySelfReferral) {
    return { ...session, channel: "direct", source: "direct", medium: null, referrerOrigin: null };
  }
  return { ...session, referrerOrigin: session.referrerOrigin ?? null };
}

function cloneClickIds(value: WebsiteAnalyticsConsentQualifiedClickIds | null | undefined): WebsiteAnalyticsConsentQualifiedClickIds | null {
  const entries = WEBSITE_CLICK_ID_TYPES.flatMap((key) => {
    const identifier = value?.[key];
    return typeof identifier === "string" && identifier.length > 0 ? [[key, identifier] as const] : [];
  });
  return entries.length > 0 ? Object.freeze(Object.fromEntries(entries)) : null;
}

function snapshot(
  model: "first_touch" | "last_touch",
  session: NormalizedSession | null,
  conversion: WebsiteAnalyticsAttributionConversion,
  channel: WebsiteAnalyticsV2Channel = "unattributed",
): WebsiteAnalyticsAttributionSnapshot {
  const isSessionAttributed = session !== null;
  const manual = channel === "manual";
  return Object.freeze({
    model,
    sessionId: session?.id ?? null,
    channel: session?.channel ?? channel,
    source: session?.source ?? (manual
      ? ANALYTICS_DIMENSION_SENTINELS.manualOffline
      : ANALYTICS_DIMENSION_SENTINELS.unattributed),
    medium: session?.medium ?? null,
    campaign: session?.campaign ?? null,
    term: session?.term ?? null,
    content: session?.content ?? null,
    landingPath: session?.landingPath ?? null,
    externalReferrerOrigin: session?.referrerOrigin ?? null,
    market: session?.market ?? null,
    countryCode: session?.countryCode ?? null,
    deviceCategory: session?.deviceCategory ?? null,
    consentQualifiedClickIds: isSessionAttributed ? cloneClickIds(session.consentQualifiedClickIds) : null,
    attributedAt: conversion.occurredAt.toISOString(),
    visitorReference: isSessionAttributed ? conversion.visitorDigest ?? null : null,
    conversionReference: conversion.sourceReference ?? null,
    rulesVersion: WEBSITE_ANALYTICS_V2_RULES_VERSION,
  });
}

function emptyResolution(conversion: WebsiteAnalyticsAttributionConversion, channel: WebsiteAnalyticsV2Channel = "unattributed") {
  return Object.freeze({
    convertingSessionId: null,
    firstSessionId: null,
    lastSessionId: null,
    lastNonDirectSessionId: null,
    firstTouch: snapshot("first_touch", null, conversion, channel),
    lastTouch: snapshot("last_touch", null, conversion, channel),
  });
}

export function resolveWebsiteAnalyticsAttribution(input: Readonly<{
  conversion: WebsiteAnalyticsAttributionConversion;
  sessions: readonly WebsiteAnalyticsAttributionSession[];
  lookbackDays?: number;
}>): Readonly<{
  convertingSessionId: string | null;
  firstSessionId: string | null;
  lastSessionId: string | null;
  lastNonDirectSessionId: string | null;
  firstTouch: WebsiteAnalyticsAttributionSnapshot;
  lastTouch: WebsiteAnalyticsAttributionSnapshot;
}> {
  const { conversion } = input;
  if (conversion.source === "manual") return emptyResolution(conversion, "manual");
  if (!conversion.consentLinked || conversion.historical || !conversion.visitorDigest || !conversion.convertingSessionId) {
    return emptyResolution(conversion);
  }
  const lookbackDays = input.lookbackDays ?? 90;
  const cutoff = new Date(conversion.occurredAt.getTime() - lookbackDays * 86_400_000);
  const sessions = input.sessions.filter((session) => session.visitorDigest === conversion.visitorDigest
    && session.startedAt >= cutoff && session.startedAt <= conversion.occurredAt)
    .map(normalizeSession)
    .sort((left, right) => left.startedAt.getTime() - right.startedAt.getTime() || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const converting = sessions.find((session) => session.id === conversion.convertingSessionId) ?? null;
  if (!converting) return emptyResolution(conversion);
  const first = sessions[0] ?? converting;
  const last = sessions.at(-1) ?? converting;
  const lastNonDirect = [...sessions].reverse().find((session) => session.channel !== "direct") ?? null;
  return Object.freeze({
    convertingSessionId: converting.id,
    firstSessionId: first.id,
    lastSessionId: last.id,
    lastNonDirectSessionId: lastNonDirect?.id ?? null,
    firstTouch: snapshot("first_touch", first, conversion),
    lastTouch: snapshot("last_touch", lastNonDirect ?? converting, conversion),
  });
}
