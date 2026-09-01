import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { CustomerServiceRepository } from "../repositories/customer-service-repository";

export const WEBSITE_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

const SECURE_COOKIE_NAME = "__Host-rnr_customer_chat";
const LOCAL_COOKIE_NAME = "rnr_customer_chat";

type CookieEnvironment = "production" | "preview" | "development" | "test" | undefined;

type WebsiteSessionRepository = Pick<
  CustomerServiceRepository,
  "resolveWebsiteSession" | "ensureWebsiteSession"
>;

type WebsiteSessionLookupRepository = Pick<CustomerServiceRepository, "resolveWebsiteSession">;

export type WebsiteSession = Readonly<{
  conversationId: string;
  expiresAt: Date;
}>;

const WEBSITE_SESSION_PERMIT_MAX_AGE_SECONDS = 90;
const permitVersion = "v1";
const permitNoncePattern = /^[A-Za-z0-9_-]{22}$/;
const permitMacPattern = /^[A-Za-z0-9_-]{43}$/;

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

function hmacPermit(input: Readonly<{
  token: string;
  clientMessageKey: string;
  sessionExpiresAt: Date;
  permitExpiresAt: Date;
  nonce: string;
  sessionSecret: string;
  permitSecret: string;
}>) {
  const sessionTokenHash = hashWebsiteSessionToken(input.token, input.sessionSecret);
  return createHmac("sha256", input.permitSecret)
    .update([
      "customer-chat-session-permit",
      sessionTokenHash,
      input.clientMessageKey,
      String(Math.floor(input.sessionExpiresAt.getTime() / 1_000)),
      String(Math.floor(input.permitExpiresAt.getTime() / 1_000)),
      input.nonce,
    ].join("\0"))
    .digest("base64url");
}

function dateFromEpochSeconds(value: string) {
  if (!/^[1-9][0-9]{0,11}$/.test(value)) return null;
  const milliseconds = Number(value) * 1_000;
  return Number.isSafeInteger(milliseconds) ? new Date(milliseconds) : null;
}

export function createWebsiteSessionPermit(input: Readonly<{
  token: string;
  clientMessageKey: string;
  sessionExpiresAt: Date;
  now: Date;
  sessionSecret: string;
  permitSecret: string;
  nonce?: string;
}>) {
  const nonce = input.nonce ?? randomBytes(16).toString("base64url");
  if (!permitNoncePattern.test(nonce)) throw new Error("website_session_permit_nonce_invalid");
  const permitExpiresAt = new Date(input.now.getTime() + WEBSITE_SESSION_PERMIT_MAX_AGE_SECONDS * 1_000);
  const sessionExpiry = Math.floor(input.sessionExpiresAt.getTime() / 1_000);
  const permitExpiry = Math.floor(permitExpiresAt.getTime() / 1_000);
  if (!Number.isSafeInteger(sessionExpiry) || input.sessionExpiresAt <= input.now) {
    throw new Error("website_session_permit_session_expiry_invalid");
  }
  const mac = hmacPermit({ ...input, nonce, permitExpiresAt });
  return `${permitVersion}.${sessionExpiry}.${permitExpiry}.${nonce}.${mac}`;
}

export function validateWebsiteSessionPermit(input: Readonly<{
  permit: string | null;
  token: string;
  clientMessageKey: string;
  now: Date;
  sessionSecret: string;
  permitSecret: string;
}>) {
  if (!input.permit || input.permit.length > 256) return null;
  const parts = input.permit.split(".");
  if (parts.length !== 5) return null;
  const [version, sessionExpiry, permitExpiry, nonce, mac] = parts;
  if (version !== permitVersion || !permitNoncePattern.test(nonce) || !permitMacPattern.test(mac)) return null;
  const sessionExpiresAt = dateFromEpochSeconds(sessionExpiry);
  const permitExpiresAt = dateFromEpochSeconds(permitExpiry);
  if (!sessionExpiresAt || !permitExpiresAt || sessionExpiresAt <= input.now || permitExpiresAt <= input.now) return null;
  const expected = hmacPermit({
    token: input.token,
    clientMessageKey: input.clientMessageKey,
    sessionExpiresAt,
    permitExpiresAt,
    nonce,
    sessionSecret: input.sessionSecret,
    permitSecret: input.permitSecret,
  });
  const received = Buffer.from(mac);
  const calculated = Buffer.from(expected);
  if (received.length !== calculated.length || !timingSafeEqual(received, calculated)) return null;
  return Object.freeze({ sessionExpiresAt });
}

export async function bootstrapWebsiteSession(input: Readonly<{
  request: Request;
  repository: WebsiteSessionLookupRepository;
  sessionSecret: string;
  permitSecret: string;
  clientMessageKey: string;
  now: Date;
  environment?: CookieEnvironment;
  createToken?: () => string;
  createNonce?: () => string;
}>) {
  if (input.request.method !== "POST") throw new Error("website_session_post_required");
  const existingToken = readWebsiteSessionToken(input.request, input.environment);
  const existing = existingToken
    ? await input.repository.resolveWebsiteSession({
      sessionTokenHash: hashWebsiteSessionToken(existingToken, input.sessionSecret),
      now: input.now,
    })
    : null;
  const token = existing && existingToken
    ? existingToken
    : (input.createToken ?? createWebsiteSessionToken)();
  if (!isWebsiteSessionToken(token)) throw new Error("website_session_token_invalid");
  const sessionExpiresAt = existing?.expiresAt
    ?? new Date(input.now.getTime() + WEBSITE_SESSION_MAX_AGE_SECONDS * 1_000);
  return Object.freeze({
    permit: createWebsiteSessionPermit({
      token,
      clientMessageKey: input.clientMessageKey,
      sessionExpiresAt,
      now: input.now,
      sessionSecret: input.sessionSecret,
      permitSecret: input.permitSecret,
      nonce: input.createNonce?.(),
    }),
    cookie: existing ? null : websiteSessionCookie(token, input.environment),
  });
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
