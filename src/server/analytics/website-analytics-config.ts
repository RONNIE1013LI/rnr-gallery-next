export type WebsiteAnalyticsConfig = Readonly<{
  enabled: boolean;
  cookieSecret: string | null;
}>;

export function readWebsiteAnalyticsConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): WebsiteAnalyticsConfig {
  const enabled = env.FIRST_PARTY_ANALYTICS_ENABLED?.trim().toLowerCase() === "true";
  if (!enabled) return { enabled: false, cookieSecret: null };

  const cookieSecret = env.FIRST_PARTY_ANALYTICS_COOKIE_SECRET?.trim() ?? "";
  if (cookieSecret.length < 32) {
    throw new Error("Website analytics cookie secret must contain at least 32 characters.");
  }
  return { enabled: true, cookieSecret };
}
