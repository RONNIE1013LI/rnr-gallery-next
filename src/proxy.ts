import { NextResponse, type NextRequest } from "next/server";
import { australianCommerceDestination } from "@/domain/markets/market";
import {
  MARKET_COOKIE_NAME,
  parseMarketCookie,
} from "@/server/markets/market-cookie";
import { resolveRequestMarket } from "@/server/markets/request-market";

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname.length > 1 && pathname.endsWith("/")) {
    const canonicalUrl = new URL(request.url);
    canonicalUrl.pathname = pathname.slice(0, -1);
    return NextResponse.redirect(canonicalUrl, 308);
  }
  const resolved = resolveRequestMarket({
    pathname,
    savedPreference: parseMarketCookie(request.cookies.get(MARKET_COOKIE_NAME)?.value),
    requestCountry: request.headers.get("x-vercel-ip-country"),
    userAgent: request.headers.get("user-agent"),
  });

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
  matcher: [
    "/((?!api|_next/static|_next/image|_next/webpack-hmr|favicon.ico|robots.txt|sitemap.xml|.*\\..*).*)",
  ],
};
