import {
  normalizeWebsiteClickIdTypes,
  type WebsiteAnalyticsChannel,
  type WebsiteClickIdType,
} from "./website-analytics";

export type WebsiteAttribution = Readonly<{
  channel: WebsiteAnalyticsChannel;
  source: string;
  medium: string | null;
  utmCampaign: string | null;
  clickIdType: WebsiteClickIdType | null;
}>;

type AttributionInput = Readonly<{
  advertisingConsent: boolean;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  referrerOrigin: string | null;
  clickIdTypes: readonly unknown[];
}>;

const GOOGLE_CLICK_PRIORITY = ["gclid", "gbraid", "wbraid"] as const;
const GOOGLE_PAID_MEDIA = new Set(["cpc", "ppc", "paid", "paid_search", "sem"]);
const META_PAID_MEDIA = new Set(["paid", "paid_social", "cpc", "ppc"]);

function bounded(value: string | null, maximum: number, lowercase: boolean) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return null;
  const result = normalized.slice(0, maximum);
  return lowercase ? result.toLowerCase() : result;
}

function sourceKey(source: string | null) {
  return source?.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") ?? null;
}

function referrerHost(origin: string | null) {
  if (!origin) return null;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.hostname.toLowerCase().replace(/^www\./, "").slice(0, 255) || null;
  } catch {
    return null;
  }
}

function isGoogleSearchHost(host: string | null) {
  return host !== null
    && /^google\.(?:com|[a-z]{2}|(?:co|com)\.[a-z]{2})$/.test(host);
}

function result(
  channel: WebsiteAnalyticsChannel,
  source: string,
  medium: string | null,
  utmCampaign: string | null,
  clickIdType: WebsiteClickIdType | null = null,
): WebsiteAttribution {
  return Object.freeze({ channel, source, medium, utmCampaign, clickIdType });
}

export function classifyWebsiteAttribution(input: AttributionInput): WebsiteAttribution {
  const source = bounded(input.utmSource, 255, true);
  const medium = bounded(input.utmMedium, 100, true);
  const campaign = bounded(input.utmCampaign, 100, false);
  const key = sourceKey(source);
  const clickTypes = input.advertisingConsent
    ? normalizeWebsiteClickIdTypes(input.clickIdTypes)
    : [];
  const googleClicks = GOOGLE_CLICK_PRIORITY.filter((value) => clickTypes.includes(value));
  const hasMetaClick = clickTypes.includes("fbclid");

  if (googleClicks.length > 0 && hasMetaClick) {
    return result("other", "conflicting_paid_signals", null, campaign);
  }
  if (googleClicks.length > 0) {
    return result("google_ads", "google", "paid_click", campaign, googleClicks[0]);
  }
  if (hasMetaClick) {
    return result("meta_ads", "meta", "paid_click", campaign, "fbclid");
  }

  if ((key === "google" || key === "google_ads") && medium && GOOGLE_PAID_MEDIA.has(medium)) {
    return result("google_ads", source ?? "google", medium, campaign);
  }
  if (
    (key === "facebook" || key === "instagram" || key === "meta")
    && medium
    && META_PAID_MEDIA.has(medium)
  ) {
    return result("meta_ads", source ?? "meta", medium, campaign);
  }
  if (medium && (GOOGLE_PAID_MEDIA.has(medium) || META_PAID_MEDIA.has(medium))) {
    return result("other", source ?? "unknown", medium, campaign);
  }

  const host = referrerHost(input.referrerOrigin);
  if (key === "google" || key === "google_organic" || isGoogleSearchHost(host)) {
    return result("google_organic", source ?? "google", medium ?? "organic", campaign);
  }
  if (source) return result("other", source, medium, campaign);
  if (host) return result("other", host, "referral", campaign);
  return result("direct", "direct", null, campaign);
}
