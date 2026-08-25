import type { Market } from "@/domain/markets/types";

export type MarketResolutionSource = "route" | "saved" | "geo" | "fallback";

export type ResolvedRequestMarket = Readonly<{
  market: Market;
  source: MarketResolutionSource;
}>;

const CRAWLER_USER_AGENT = /(?:bot|crawler|spider|facebookexternalhit|slurp)/i;

export function isAustralianMarketPath(pathname: string): boolean {
  return pathname === "/au" || pathname.startsWith("/au/");
}

export function resolveRequestMarket({
  pathname,
  savedPreference,
  requestCountry,
  userAgent,
}: Readonly<{
  pathname: string;
  savedPreference: Market | null;
  requestCountry: string | null;
  userAgent: string | null;
}>): ResolvedRequestMarket {
  if (isAustralianMarketPath(pathname)) {
    return { market: "AU", source: "route" };
  }
  if (savedPreference) {
    return { market: savedPreference, source: "saved" };
  }
  if (userAgent && CRAWLER_USER_AGENT.test(userAgent)) {
    return { market: "NZ", source: "fallback" };
  }
  const country = requestCountry?.trim().toUpperCase();
  if (country === "NZ" || country === "AU") {
    return { market: country, source: "geo" };
  }
  return { market: "NZ", source: "fallback" };
}
