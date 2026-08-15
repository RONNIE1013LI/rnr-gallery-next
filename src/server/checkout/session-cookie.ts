import { createHash, randomBytes } from "node:crypto";

export const CHECKOUT_SESSION_COOKIE_NAME = "rnr_checkout_session_guest";
export const CHECKOUT_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function createCheckoutSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashCheckoutSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function getCheckoutSessionCookieName(customerId: string | null): string {
  if (customerId === null) return CHECKOUT_SESSION_COOKIE_NAME;
  const digest = createHash("sha256").update(customerId, "utf8").digest("hex").slice(0, 32);
  return `rnr_checkout_session_user_${digest}`;
}

export function isCheckoutSessionToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function sessionCookie(
  token: string,
  environment: string | undefined = process.env.NODE_ENV,
  customerId: string | null = null,
) {
  return {
    name: getCheckoutSessionCookieName(customerId),
    value: token,
    httpOnly: true as const,
    sameSite: "lax" as const,
    path: "/",
    secure: process.env.NODE_ENV === "production" || environment === "production",
    maxAge: CHECKOUT_SESSION_MAX_AGE_SECONDS,
  };
}

export function readCheckoutSessionToken(request: Request, customerId: string | null = null): string | null {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name !== getCheckoutSessionCookieName(customerId)) continue;
    const value = part.slice(separator + 1).trim();
    return isCheckoutSessionToken(value) ? value : null;
  }

  return null;
}
