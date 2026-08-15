import { describe, expect, it } from "vitest";
import {
  MARKET_COOKIE_NAME,
  marketCookieHeader,
  parseMarketCookie,
  resolveBrowseMarket,
} from "./market-cookie";

describe("market cookie", () => {
  it("accepts only NZ and AU values", () => {
    expect(parseMarketCookie("NZ")).toBe("NZ");
    expect(parseMarketCookie("AU")).toBe("AU");
    expect(parseMarketCookie("user:123")).toBeNull();
    expect(parseMarketCookie(undefined)).toBeNull();
  });

  it("lets explicit AU routes override a saved NZ preference", () => {
    expect(resolveBrowseMarket("/au/products/roll-up-banner", "NZ")).toBe("AU");
    expect(resolveBrowseMarket("/products/roll-up-banner", "AU")).toBe("AU");
    expect(resolveBrowseMarket("/products/roll-up-banner", null)).toBe("NZ");
  });

  it("serializes a non-sensitive secure market preference", () => {
    const header = marketCookieHeader("AU", true);
    expect(header).toContain(`${MARKET_COOKIE_NAME}=AU`);
    expect(header).toContain("Path=/");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Secure");
    expect(header).not.toContain("user");
  });
});
