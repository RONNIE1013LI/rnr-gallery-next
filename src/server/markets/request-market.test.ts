import { describe, expect, it } from "vitest";
import { resolveRequestMarket } from "./request-market";

describe("request market resolution", () => {
  it.each([
    ["NZ", "NZ"],
    ["AU", "AU"],
    ["US", "NZ"],
    [null, "NZ"],
    ["", "NZ"],
  ] as const)("maps request country %s to %s without a saved preference", (
    country,
    expected,
  ) => {
    expect(resolveRequestMarket({
      pathname: "/",
      savedPreference: null,
      requestCountry: country,
      userAgent: "Mozilla/5.0",
    })).toEqual({ market: expected, source: country === "NZ" || country === "AU" ? "geo" : "fallback" });
  });

  it("always gives a valid saved customer preference priority over geo", () => {
    expect(resolveRequestMarket({
      pathname: "/shop",
      savedPreference: "NZ",
      requestCountry: "AU",
      userAgent: "Mozilla/5.0",
    })).toEqual({ market: "NZ", source: "saved" });
    expect(resolveRequestMarket({
      pathname: "/shop",
      savedPreference: "AU",
      requestCountry: "NZ",
      userAgent: "Mozilla/5.0",
    })).toEqual({ market: "AU", source: "saved" });
  });

  it("honours an explicit AU URL for that request without changing the saved preference", () => {
    expect(resolveRequestMarket({
      pathname: "/au/products/photo-print-canvas",
      savedPreference: "NZ",
      requestCountry: "NZ",
      userAgent: "Mozilla/5.0",
    })).toEqual({ market: "AU", source: "route" });
  });

  it.each([
    "Googlebot/2.1 (+http://www.google.com/bot.html)",
    "facebookexternalhit/1.1",
    "bingbot/2.0",
  ])("keeps unprefixed crawler requests on stable NZ routes for %s", (userAgent) => {
    expect(resolveRequestMarket({
      pathname: "/products/photo-print-canvas",
      savedPreference: null,
      requestCountry: "AU",
      userAgent,
    })).toEqual({ market: "NZ", source: "fallback" });
  });

  it("still honours an explicit AU canonical route for crawlers", () => {
    expect(resolveRequestMarket({
      pathname: "/au/products/photo-print-canvas",
      savedPreference: null,
      requestCountry: "NZ",
      userAgent: "Googlebot/2.1",
    })).toEqual({ market: "AU", source: "route" });
  });
});
