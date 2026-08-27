export const ADVERTISING_CONSENT_COOKIE = "rnr-consent-v1";
export const ADVERTISING_CONSENT_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export type AdvertisingConsent = Readonly<{
  version: 1;
  analytics: boolean;
  advertising: boolean;
  decidedAt: string;
}>;

const MAX_CONSENT_VALUE_LENGTH = 512;
const CONSENT_KEYS = ["advertising", "analytics", "decidedAt", "version"] as const;

function isCanonicalIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

export function parseAdvertisingConsent(value: string | undefined): AdvertisingConsent | null {
  if (!value || value.length > MAX_CONSENT_VALUE_LENGTH) return null;

  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(value));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (keys.length !== CONSENT_KEYS.length
      || keys.some((key, index) => key !== CONSENT_KEYS[index])) return null;
    if (record.version !== 1
      || typeof record.analytics !== "boolean"
      || typeof record.advertising !== "boolean"
      || !isCanonicalIsoDate(record.decidedAt)) {
      return null;
    }
    return Object.freeze({
      version: 1,
      analytics: record.analytics,
      advertising: record.advertising,
      decidedAt: record.decidedAt,
    });
  } catch {
    return null;
  }
}

export function serializeAdvertisingConsent(value: AdvertisingConsent): string {
  return JSON.stringify({
    version: 1,
    analytics: value.analytics,
    advertising: value.advertising,
    decidedAt: value.decidedAt,
  });
}

export function advertisingConsentCookieHeader(
  value: AdvertisingConsent,
  environment: string | undefined,
): string {
  const secure = process.env.NODE_ENV === "production" || environment === "production";
  return [
    `${ADVERTISING_CONSENT_COOKIE}=${encodeURIComponent(serializeAdvertisingConsent(value))}`,
    "Path=/",
    `Max-Age=${ADVERTISING_CONSENT_MAX_AGE_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}
