import { createHmac } from "node:crypto";
import { isIP } from "node:net";

const DAY_MS = 24 * 60 * 60 * 1_000;

function utcDay(now: Date) {
  return now.toISOString().slice(0, 10);
}

function validIp(value: string | null | undefined) {
  return value && isIP(value) !== 0 ? value : null;
}

export function resolveTrustedClientIp(request: Request, injectedIp?: string) {
  const injected = validIp(injectedIp);
  if (injected) return injected;

  if (process.env.VERCEL !== "1") {
    throw new Error("website_trusted_client_ip_unavailable");
  }
  // Vercel overwrites this header at its edge. It is never read from request bodies.
  const forwarded = validIp(request.headers.get("x-vercel-forwarded-for"));
  if (forwarded) return forwarded;
  throw new Error("website_trusted_client_ip_unavailable");
}

export function hashTrustedNetworkBucket(input: Readonly<{
  ip: string;
  secret: string;
  now: Date;
}>) {
  if (!validIp(input.ip) || input.secret.length < 32) {
    throw new Error("website_network_bucket_identity_invalid");
  }
  return createHmac("sha256", input.secret)
    .update(`website-network\0${utcDay(input.now)}\0${input.ip}`)
    .digest("hex");
}

export const WEBSITE_RATE_LIMITS = Object.freeze({
  sessionMinute: 5,
  sessionHour: 30,
  sessionTotal: 100,
  networkMinute: 10,
  networkHour: 60,
  maxNetworkBucketLifetimeMs: DAY_MS,
});
