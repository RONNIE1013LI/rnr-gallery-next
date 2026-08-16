import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_VERSION = "v1";
const DEFAULT_TTL_MS = 90 * 24 * 60 * 60 * 1_000;
const tokenPattern = /^v1\.([0-9]{1,12})\.([A-Za-z0-9_-]{43})$/;

function signature(orderNumber: string, expiresAtSeconds: number, secret: string) {
  return createHmac("sha256", secret)
    .update(`order-email-access:${TOKEN_VERSION}:${orderNumber}:${expiresAtSeconds}`)
    .digest("base64url");
}

export function createOrderEmailAccessToken(
  orderNumber: string,
  secret: string,
  now = new Date(),
  ttlMs = DEFAULT_TTL_MS,
) {
  if (secret.length < 32) throw new Error("Order email access secret is unavailable");
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) throw new Error("Order email access TTL is invalid");
  const expiresAtSeconds = Math.floor((now.getTime() + ttlMs) / 1_000);
  return `${TOKEN_VERSION}.${expiresAtSeconds}.${signature(orderNumber, expiresAtSeconds, secret)}`;
}

export function verifyOrderEmailAccessToken(
  token: string | null | undefined,
  orderNumber: string,
  secret: string,
  now = new Date(),
) {
  if (!token || secret.length < 32) return false;
  const match = tokenPattern.exec(token);
  if (!match) return false;
  const expiresAtSeconds = Number(match[1]);
  if (!Number.isSafeInteger(expiresAtSeconds) || expiresAtSeconds <= Math.floor(now.getTime() / 1_000)) {
    return false;
  }
  const expected = Buffer.from(signature(orderNumber, expiresAtSeconds, secret), "utf8");
  const actual = Buffer.from(match[2], "utf8");
  return expected.byteLength === actual.byteLength && timingSafeEqual(expected, actual);
}
