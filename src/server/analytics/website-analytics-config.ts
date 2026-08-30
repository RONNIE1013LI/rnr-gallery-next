export type WebsiteAnalyticsConfig = Readonly<{
  enabled: boolean;
  cookieSecret: string | null;
}>;

export type WebsiteAnalyticsRuntimeConfig = WebsiteAnalyticsConfig & Readonly<{
  v2Enabled: boolean;
  attributionLookbackDays: number;
}>;

const DEFAULT_ATTRIBUTION_LOOKBACK_DAYS = 90;

function attributionLookbackDays(value: string | undefined): number {
  const parsed = Number(value);
  if (!value?.trim() || !Number.isSafeInteger(parsed) || parsed < 1) {
    return DEFAULT_ATTRIBUTION_LOOKBACK_DAYS;
  }
  return Math.min(parsed, DEFAULT_ATTRIBUTION_LOOKBACK_DAYS);
}

export function readWebsiteAnalyticsConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): WebsiteAnalyticsRuntimeConfig {
  const enabled = env.FIRST_PARTY_ANALYTICS_ENABLED?.trim().toLowerCase() === "true";
  const shared = {
    v2Enabled: env.WEBSITE_ANALYTICS_V2_ENABLED?.trim().toLowerCase() === "true",
    attributionLookbackDays: attributionLookbackDays(env.ANALYTICS_ATTRIBUTION_LOOKBACK_DAYS),
  };
  if (!enabled) return { enabled: false, cookieSecret: null, ...shared };

  const cookieSecret = env.FIRST_PARTY_ANALYTICS_COOKIE_SECRET?.trim() ?? "";
  if (cookieSecret.length < 32) {
    throw new Error("Website analytics cookie secret must contain at least 32 characters.");
  }
  return { enabled: true, cookieSecret, ...shared };
}
