export const WEBSITE_ANALYTICS_CHANNELS = [
  "google_ads",
  "meta_ads",
  "google_organic",
  "direct",
  "other",
] as const;

export type WebsiteAnalyticsChannel = (typeof WEBSITE_ANALYTICS_CHANNELS)[number];

export const WEBSITE_CLICK_ID_TYPES = [
  "gclid",
  "gbraid",
  "wbraid",
  "fbclid",
] as const;

export type WebsiteClickIdType = (typeof WEBSITE_CLICK_ID_TYPES)[number];

export function isWebsiteAnalyticsChannel(value: unknown): value is WebsiteAnalyticsChannel {
  return typeof value === "string"
    && (WEBSITE_ANALYTICS_CHANNELS as readonly string[]).includes(value);
}

export function normalizeCountryCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null;
}

export function normalizeWebsiteClickIdTypes(
  values: readonly unknown[],
): WebsiteClickIdType[] {
  const present = new Set(values.filter(
    (value): value is WebsiteClickIdType => typeof value === "string"
      && (WEBSITE_CLICK_ID_TYPES as readonly string[]).includes(value),
  ));
  return WEBSITE_CLICK_ID_TYPES.filter((value) => present.has(value));
}
