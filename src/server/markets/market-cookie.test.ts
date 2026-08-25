import { describe, expect, it } from "vitest";
import {
  MARKET_COOKIE_NAME,
  marketCookieHeader,
  parseMarketCookie,
} from "./market-cookie";

describe("market cookie", () => {
  it("accepts only NZ and AU values", () => {
    expect(parseMarketCookie("NZ")).toBe("NZ");
    expect(parseMarketCookie("AU")).toBe("AU");
    expect(parseMarketCookie("user:123")).toBeNull();
    expect(parseMarketCookie(undefined)).toBeNull();
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
