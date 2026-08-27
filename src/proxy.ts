import { NextResponse, type NextRequest } from "next/server";
import { australianCommerceDestination } from "@/domain/markets/market";
import {
  MARKET_COOKIE_NAME,
  parseMarketCookie,
} from "@/server/markets/market-cookie";
import { resolveRequestMarket } from "@/server/markets/request-market";
import { getLegacyRedirectDestination } from "@/server/seo/legacy-redirects";

const canonicalRedirectHosts = new Set([
  "www.rnrgallery.com",
  "rrgallery.co.nz",
  "www.rrgallery.co.nz",
]);

function isApiPath(pathname: string) {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function skipsStorefrontMarketLogic(pathname: string) {
  return isApiPath(pathname)
    || pathname.startsWith("/_next/static")
    || pathname.startsWith("/_next/image")
    || pathname.startsWith("/_next/webpack-hmr")
    || pathname === "/favicon.ico"
    || pathname === "/robots.txt"
    || pathname === "/sitemap.xml"
    || pathname.includes(".");
}

function resolveMarket(request: NextRequest) {
  return resolveRequestMarket({
    pathname: request.nextUrl.pathname,
    savedPreference: parseMarketCookie(request.cookies.get(MARKET_COOKIE_NAME)?.value),
    requestCountry: request.headers.get("x-vercel-ip-country"),
    userAgent: request.headers.get("user-agent"),
  });
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const legacyDestination = getLegacyRedirectDestination(pathname);
  if (legacyDestination) {
    const resolved = resolveMarket(request);
    const destination = resolved.market === "AU"
      ? australianCommerceDestination(legacyDestination) ?? legacyDestination
      : legacyDestination;
    const redirectUrl = new URL(destination, "https://rnrgallery.com");
    redirectUrl.search = request.nextUrl.search;
    return NextResponse.redirect(redirectUrl, 301);
  }

  if (pathname.length > 1 && pathname.endsWith("/")) {
    const canonicalUrl = new URL(request.url);
    canonicalUrl.pathname = pathname.slice(0, -1);
    return NextResponse.redirect(canonicalUrl, 308);
  }

  if (!isApiPath(pathname) && canonicalRedirectHosts.has(request.nextUrl.hostname)) {
    const canonicalUrl = new URL(request.url);
    canonicalUrl.protocol = "https:";
    canonicalUrl.hostname = "rnrgallery.com";
    canonicalUrl.port = "";
    return NextResponse.redirect(canonicalUrl, 301);
  }

  if (skipsStorefrontMarketLogic(pathname)) return NextResponse.next();

  const resolved = resolveMarket(request);

  if (resolved.market === "AU") {
    const destination = australianCommerceDestination(pathname);
    if (destination && destination !== pathname) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = destination;
      return NextResponse.redirect(redirectUrl);
    }
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(
    "x-rnr-request-path",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  requestHeaders.set("x-rnr-resolved-market", resolved.market);
  requestHeaders.set("x-rnr-market-source", resolved.source);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/:path*"],
};
