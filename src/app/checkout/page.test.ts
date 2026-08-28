import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("checkout request market", () => {
  it("renders from the server-resolved request market before the saved cookie", () => {
    const source = readFileSync("src/app/checkout/page.tsx", "utf8");

    expect(source).toContain("headers()");
    expect(source).toContain('requestHeaders.get("x-rnr-resolved-market")');
    expect(source.indexOf('requestHeaders.get("x-rnr-resolved-market")'))
      .toBeLessThan(source.indexOf("cookieStore.get(MARKET_COOKIE_NAME)"));
    expect(source).toContain("<CheckoutView key={market} market={market}");
  });
});
