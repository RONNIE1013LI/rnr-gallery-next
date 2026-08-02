import { createHash, randomBytes } from "node:crypto";

export const CHECKOUT_SESSION_COOKIE_NAME = "rnr_checkout_session";
export const CHECKOUT_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function createCheckoutSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashCheckoutSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function sessionCookie(
  token: string,
  environment: string | undefined = process.env.NODE_ENV,
) {
  return {
    name: CHECKOUT_SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true as const,
    sameSite: "lax" as const,
    path: "/",
    secure: environment === "production",
    maxAge: CHECKOUT_SESSION_MAX_AGE_SECONDS,
  };
}

export function readCheckoutSessionToken(request: Request): string | null {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name !== CHECKOUT_SESSION_COOKIE_NAME) continue;
    const value = part.slice(separator + 1).trim();
    return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
  }

  return null;
}
