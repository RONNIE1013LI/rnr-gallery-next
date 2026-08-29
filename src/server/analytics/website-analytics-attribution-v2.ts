import {
  WEBSITE_ANALYTICS_V2_RULES_VERSION,
  type WebsiteAnalyticsV2Channel,
} from "@/domain/analytics/website-analytics-v2";
import type { WebsiteAnalyticsChannel } from "@/domain/analytics/website-analytics";

export type WebsiteAnalyticsAttributionSession = Readonly<{
  id: string;
  visitorDigest: string;
  startedAt: Date;
  channel: WebsiteAnalyticsChannel;
  source: string;
  medium: string | null;
  campaign: string | null;
  referrerOrigin?: string | null;
}>;

export type WebsiteAnalyticsAttributionConversion = Readonly<{
  occurredAt: Date;
  visitorDigest?: string | null;
  convertingSessionId?: string | null;
  consentLinked: boolean;
  source?: "website" | "manual";
  historical?: boolean;
}>;

export type WebsiteAnalyticsAttributionSnapshot = Readonly<{
  model: "first_touch" | "last_touch";
  sessionId: string | null;
  channel: WebsiteAnalyticsV2Channel;
  source: string;
  medium: string | null;
  campaign: string | null;
  rulesVersion: typeof WEBSITE_ANALYTICS_V2_RULES_VERSION;
}>;

type NormalizedSession = WebsiteAnalyticsAttributionSession & Readonly<{
  channel: WebsiteAnalyticsChannel;
  source: string;
  medium: string | null;
}>;

const OWN_HOSTS = new Set(["rrgallery.co.nz", "www.rrgallery.co.nz"]);

function isOwnReferrer(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    return OWN_HOSTS.has(new URL(value).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function normalizeSession(session: WebsiteAnalyticsAttributionSession): NormalizedSession {
  if (isOwnReferrer(session.referrerOrigin) || OWN_HOSTS.has(session.source.toLowerCase())) {
    return { ...session, channel: "direct", source: "direct", medium: null };
  }
  return session;
}

function snapshot(model: "first_touch" | "last_touch", session: NormalizedSession | null): WebsiteAnalyticsAttributionSnapshot {
  if (!session) return Object.freeze({
    model, sessionId: null, channel: "unattributed", source: "Unattributed", medium: null, campaign: null,
    rulesVersion: WEBSITE_ANALYTICS_V2_RULES_VERSION,
  });
  return Object.freeze({
    model, sessionId: session.id, channel: session.channel, source: session.source, medium: session.medium,
    campaign: session.campaign, rulesVersion: WEBSITE_ANALYTICS_V2_RULES_VERSION,
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
  if (!conversion.consentLinked || conversion.source === "manual" || conversion.historical || !conversion.visitorDigest || !conversion.convertingSessionId) {
    return Object.freeze({
      convertingSessionId: null, firstSessionId: null, lastSessionId: null, lastNonDirectSessionId: null,
      firstTouch: snapshot("first_touch", null), lastTouch: snapshot("last_touch", null),
    });
  }
  const lookbackDays = input.lookbackDays ?? 90;
  const cutoff = new Date(conversion.occurredAt.getTime() - lookbackDays * 86_400_000);
  const sessions = input.sessions.filter((session) => session.visitorDigest === conversion.visitorDigest
    && session.startedAt >= cutoff && session.startedAt <= conversion.occurredAt)
    .map(normalizeSession)
    .sort((left, right) => left.startedAt.getTime() - right.startedAt.getTime());
  const converting = sessions.find((session) => session.id === conversion.convertingSessionId) ?? null;
  if (!converting) return Object.freeze({
    convertingSessionId: null, firstSessionId: null, lastSessionId: null, lastNonDirectSessionId: null,
    firstTouch: snapshot("first_touch", null), lastTouch: snapshot("last_touch", null),
  });
  const first = sessions[0] ?? converting;
  const last = sessions.at(-1) ?? converting;
  const lastNonDirect = [...sessions].reverse().find((session) => session.channel !== "direct") ?? null;
  return Object.freeze({
    convertingSessionId: converting.id,
    firstSessionId: first.id,
    lastSessionId: last.id,
    lastNonDirectSessionId: lastNonDirect?.id ?? null,
    firstTouch: snapshot("first_touch", first),
    lastTouch: snapshot("last_touch", lastNonDirect ?? converting),
  });
}
