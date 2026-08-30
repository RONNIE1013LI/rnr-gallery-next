import {
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

export const WEBSITE_ANALYTICS_VISITOR_COOKIE = "ra_vid_v1";
export const WEBSITE_ANALYTICS_SESSION_COOKIE = "ra_sid_v1";
export const WEBSITE_ANALYTICS_INTERNAL_COOKIE = "ra_internal_v1";
export const WEBSITE_ANALYTICS_SESSION_MAX_AGE_SECONDS = 30 * 60;
export const WEBSITE_ANALYTICS_VISITOR_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
export const WEBSITE_ANALYTICS_INTERNAL_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

const VERSION = "v1";
const CLOCK_SKEW_MS = 5 * 60_000;
type CookiePurpose = "visitor" | "session" | "internal";

type WebsiteAnalyticsIdentity = Readonly<{
  visitorId: string;
  sessionId: string;
  visitorCookie: string;
  sessionCookie: string;
}>;

function signature(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function signedValue(id: string, at: Date, secret: string, purpose: CookiePurpose): string {
  const payload = Buffer.from(JSON.stringify({ id, at: at.getTime(), purpose })).toString("base64url");
  const unsigned = `${VERSION}.${payload}`;
  return `${unsigned}.${signature(unsigned, secret)}`;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseSignedValue(
  value: string | undefined,
  secret: string,
  expectedPurpose: CookiePurpose,
  allowLegacy = false,
): Readonly<{
  id: string;
  at: Date;
}> | null {
  if (!value || value.length > 512) return null;
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  const unsigned = `${parts[0]}.${parts[1]}`;
  const expected = Buffer.from(signature(unsigned, secret));
  const provided = Buffer.from(parts[2]);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const keys = Object.keys(record).sort().join(",");
    const legacy = keys === "at,id";
    if ((!legacy && keys !== "at,id,purpose")
      || (legacy && !allowLegacy)
      || (!legacy && record.purpose !== expectedPurpose)
      || !isUuid(record.id)
      || typeof record.at !== "number"
      || !Number.isSafeInteger(record.at)) return null;
    const at = new Date(record.at);
    if (Number.isNaN(at.getTime())) return null;
    return { id: record.id, at };
  } catch {
    return null;
  }
}

export function createWebsiteAnalyticsIdentity(
  secret: string,
  now = new Date(),
): WebsiteAnalyticsIdentity {
  const visitorId = randomUUID();
  const sessionId = randomUUID();
  return {
    visitorId,
    sessionId,
    visitorCookie: signedValue(visitorId, now, secret, "visitor"),
    sessionCookie: signedValue(sessionId, now, secret, "session"),
  };
}

export function renewWebsiteAnalyticsSession(
  sessionId: string,
  secret: string,
  now = new Date(),
): string {
  if (!isUuid(sessionId)) throw new Error("Invalid analytics session ID.");
  return signedValue(sessionId, now, secret, "session");
}

export function createWebsiteAnalyticsVisitor(secret: string, now = new Date()) {
  const visitorId = randomUUID();
  return { visitorId, visitorCookie: signedValue(visitorId, now, secret, "visitor") };
}

export function createWebsiteAnalyticsSession(secret: string, now = new Date()) {
  const sessionId = randomUUID();
  return { sessionId, sessionCookie: signedValue(sessionId, now, secret, "session") };
}

export function createWebsiteAnalyticsInternalDevice(secret: string, now = new Date()): string {
  return signedValue(randomUUID(), now, secret, "internal");
}

export function parseWebsiteAnalyticsInternalDevice(
  value: string | undefined,
  secret: string,
  now = new Date(),
): boolean {
  const parsed = parseSignedValue(value, secret, "internal");
  if (!parsed) return false;
  const age = now.getTime() - parsed.at.getTime();
  return age >= -CLOCK_SKEW_MS && age <= WEBSITE_ANALYTICS_INTERNAL_MAX_AGE_SECONDS * 1_000;
}

export function parseWebsiteAnalyticsVisitor(
  value: string | undefined,
  secret: string,
  now = new Date(),
): Readonly<{ visitorId: string; issuedAt: Date }> | null {
  const parsed = parseSignedValue(value, secret, "visitor", true);
  if (!parsed) return null;
  const age = now.getTime() - parsed.at.getTime();
  if (age < -CLOCK_SKEW_MS || age > WEBSITE_ANALYTICS_VISITOR_MAX_AGE_SECONDS * 1_000) return null;
  return { visitorId: parsed.id, issuedAt: parsed.at };
}

export function parseWebsiteAnalyticsSession(
  value: string | undefined,
  secret: string,
  now = new Date(),
): Readonly<{ sessionId: string; lastActivityAt: Date }> | null {
  const parsed = parseSignedValue(value, secret, "session", true);
  if (!parsed) return null;
  const age = now.getTime() - parsed.at.getTime();
  if (age < -CLOCK_SKEW_MS || age > WEBSITE_ANALYTICS_SESSION_MAX_AGE_SECONDS * 1_000) return null;
  return { sessionId: parsed.id, lastActivityAt: parsed.at };
}

export function websiteAnalyticsVisitorDigest(visitorId: string, secret: string): string {
  if (!isUuid(visitorId)) throw new Error("Invalid analytics visitor ID.");
  return createHmac("sha256", secret).update(`visitor:${visitorId}`).digest("hex");
}

function cookieHeader(name: string, value: string, maxAge: number, environment: string | undefined) {
  const secure = process.env.NODE_ENV === "production" || environment === "production";
  return [
    `${name}=${value}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function websiteAnalyticsCookieHeaders(
  identity: Pick<WebsiteAnalyticsIdentity, "visitorCookie" | "sessionCookie">,
  environment: string | undefined,
): readonly string[] {
  return [
    cookieHeader(
      WEBSITE_ANALYTICS_VISITOR_COOKIE,
      identity.visitorCookie,
      WEBSITE_ANALYTICS_VISITOR_MAX_AGE_SECONDS,
      environment,
    ),
    cookieHeader(
      WEBSITE_ANALYTICS_SESSION_COOKIE,
      identity.sessionCookie,
      WEBSITE_ANALYTICS_SESSION_MAX_AGE_SECONDS,
      environment,
    ),
  ];
}

export function clearWebsiteAnalyticsCookieHeaders(environment: string | undefined): readonly string[] {
  return [
    cookieHeader(WEBSITE_ANALYTICS_VISITOR_COOKIE, "", 0, environment),
    cookieHeader(WEBSITE_ANALYTICS_SESSION_COOKIE, "", 0, environment),
  ];
}

export function websiteAnalyticsInternalDeviceCookieHeaders(
  value: string,
  enabled: boolean,
  environment: string | undefined,
): readonly string[] {
  return [
    cookieHeader(
      WEBSITE_ANALYTICS_INTERNAL_COOKIE,
      enabled ? value : "",
      enabled ? WEBSITE_ANALYTICS_INTERNAL_MAX_AGE_SECONDS : 0,
      environment,
    ),
    cookieHeader(WEBSITE_ANALYTICS_VISITOR_COOKIE, "", 0, environment),
    cookieHeader(WEBSITE_ANALYTICS_SESSION_COOKIE, "", 0, environment),
  ];
}
