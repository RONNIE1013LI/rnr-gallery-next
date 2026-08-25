import type { Market } from "@/domain/markets/types";

export const MARKET_COOKIE_NAME = "rnr-market";
const MARKET_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export function parseMarketCookie(value: string | null | undefined): Market | null {
  return value === "NZ" || value === "AU" ? value : null;
}

export function marketCookieHeader(market: Market, secure: boolean): string {
  return [
    `${MARKET_COOKIE_NAME}=${market}`,
    "Path=/",
    `Max-Age=${MARKET_COOKIE_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}
