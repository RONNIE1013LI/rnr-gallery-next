import { createHmac, randomBytes } from "node:crypto";
import type { CustomerServiceRepository } from "../repositories/customer-service-repository";

export const WEBSITE_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

const SECURE_COOKIE_NAME = "__Host-rnr_customer_chat";
const LOCAL_COOKIE_NAME = "rnr_customer_chat";

type CookieEnvironment = "production" | "preview" | "development" | "test" | undefined;

type WebsiteSessionRepository = Pick<
  CustomerServiceRepository,
  "resolveWebsiteSession" | "ensureWebsiteSession"
>;

export type WebsiteSession = Readonly<{
  conversationId: string;
  expiresAt: Date;
}>;

function secureEnvironment(environment: CookieEnvironment) {
  return environment === "production" || environment === "preview";
}

function cookieName(environment: CookieEnvironment) {
  return secureEnvironment(environment) ? SECURE_COOKIE_NAME : LOCAL_COOKIE_NAME;
}

function runtimeCookieEnvironment(): CookieEnvironment {
  return (process.env.VERCEL_ENV || process.env.NODE_ENV) as CookieEnvironment;
}

function hmac(token: string, secret: string, domain: "session-token" | "conversation") {
  if (!isWebsiteSessionToken(token)) throw new Error("website_session_token_invalid");
  return createHmac("sha256", secret).update(`${domain}\0${token}`).digest("hex");
}

export function createWebsiteSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function isWebsiteSessionToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function hashWebsiteSessionToken(token: string, secret: string) {
  return hmac(token, secret, "session-token");
}

export function hashWebsiteConversationKey(token: string, secret: string) {
  return hmac(token, secret, "conversation");
}

export function websiteSessionCookie(token: string, environment: CookieEnvironment = runtimeCookieEnvironment()) {
  if (!isWebsiteSessionToken(token)) throw new Error("website_session_token_invalid");
  return Object.freeze({
    name: cookieName(environment),
    value: token,
    httpOnly: true as const,
    sameSite: "lax" as const,
    path: "/",
    secure: secureEnvironment(environment),
    maxAge: WEBSITE_SESSION_MAX_AGE_SECONDS,
    priority: "high" as const,
  });
}

export function readWebsiteSessionToken(request: Request, environment: CookieEnvironment = runtimeCookieEnvironment()) {
  const header = request.headers.get("cookie");
  if (!header) return null;
  const expectedName = cookieName(environment);
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== expectedName) continue;
    const value = part.slice(separator + 1).trim();
    return isWebsiteSessionToken(value) ? value : null;
  }
  return null;
}

export async function resolveWebsiteSession(input: Readonly<{
  request: Request;
  repository: WebsiteSessionRepository;
  secret: string;
  now: Date;
  environment?: CookieEnvironment;
}>): Promise<WebsiteSession | null> {
  const token = readWebsiteSessionToken(input.request, input.environment);
  if (!token) return null;
  return input.repository.resolveWebsiteSession({
    sessionTokenHash: hashWebsiteSessionToken(token, input.secret),
    now: input.now,
  });
}

export async function ensureWebsiteSessionForPost(input: Readonly<{
  request: Request;
  repository: WebsiteSessionRepository;
  secret: string;
  now: Date;
  environment?: CookieEnvironment;
  createToken?: () => string;
}>): Promise<Readonly<{
  session: WebsiteSession;
  cookie: ReturnType<typeof websiteSessionCookie> | null;
}>> {
  if (input.request.method !== "POST") throw new Error("website_session_post_required");

  const existingToken = readWebsiteSessionToken(input.request, input.environment);
  const existing = await resolveWebsiteSession(input);
  if (existing && existingToken) {
    const session = await input.repository.ensureWebsiteSession({
      sessionTokenHash: hashWebsiteSessionToken(existingToken, input.secret),
      externalConversationKeyHash: hashWebsiteConversationKey(existingToken, input.secret),
      now: input.now,
      expiresAt: existing.expiresAt,
    });
    return Object.freeze({ session, cookie: null });
  }

  const token = (input.createToken ?? createWebsiteSessionToken)();
  if (!isWebsiteSessionToken(token)) throw new Error("website_session_token_invalid");
  const expiresAt = new Date(input.now.getTime() + WEBSITE_SESSION_MAX_AGE_SECONDS * 1_000);
  const session = await input.repository.ensureWebsiteSession({
    sessionTokenHash: hashWebsiteSessionToken(token, input.secret),
    externalConversationKeyHash: hashWebsiteConversationKey(token, input.secret),
    now: input.now,
    expiresAt,
  });
  return Object.freeze({
    session,
    cookie: websiteSessionCookie(token, input.environment),
  });
}

export function websiteSessionPublicState(session: WebsiteSession) {
  return Object.freeze({
    active: true as const,
    expiresAt: session.expiresAt.toISOString(),
  });
}
