import { describe, expect, it } from "vitest";
import {
  classifyGa4Location,
  GA4_DISABLE_WINDOW_KEY,
  GA4_MEASUREMENT_ID,
  GA4_SAFE_PURCHASE_PATH,
  GOOGLE_ADS_PURCHASE_SEND_TO,
  googleTagCommand,
  isGa4Production,
  safeGa4PageLocation,
} from "./runtime";

describe("GA4 runtime boundary", () => {
  it("keeps Google click attribution within GA4's serialized URL limit for Unicode campaigns", () => {
    const url = new URL("https://rnrgallery.com/products/roll-up-banner");
    url.searchParams.set("utm_source", "google");
    url.searchParams.set("utm_medium", "cpc");
    url.searchParams.set("utm_campaign", "画".repeat(120));
    url.searchParams.set("gclid", "example-click");

    const location = new URL(safeGa4PageLocation(url, true));

    expect(location.href.length).toBeLessThanOrEqual(1000);
    expect(location.searchParams.get("gclid")).toBe("example-click");
    expect(location.searchParams.get("utm_source")).toBe("google");
    expect(location.searchParams.get("utm_medium")).toBe("cpc");
    expect(location.searchParams.has("utm_campaign")).toBe(false);
  });

  it("prioritizes complete consented click IDs when combined campaign values exceed the URL limit", () => {
    const url = new URL("https://rnrgallery.com/products/roll-up-banner");
    for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_id", "utm_term", "utm_content", "utm_source_platform"]) {
      url.searchParams.set(key, "x".repeat(200));
    }
    for (const key of ["gclid", "gbraid", "wbraid"]) url.searchParams.set(key, "a".repeat(200));

    const location = new URL(safeGa4PageLocation(url, true));

    expect(location.href.length).toBeLessThanOrEqual(1000);
    for (const key of ["gclid", "gbraid", "wbraid"]) {
      expect(location.searchParams.get(key)).toBe("a".repeat(200));
    }
    expect(location.searchParams.has("utm_source_platform")).toBe(false);
  });

  it("accepts exactly 1000 serialized characters and omits whole parameters above the limit", () => {
    const prefix = "https://rnrgallery.com/";
    const query = "?utm_source=google";
    const pathname = "a".repeat(1000 - prefix.length - query.length);

    expect(safeGa4PageLocation(new URL(`${prefix}${pathname}${query}`), false))
      .toBe(`${prefix}${pathname}${query}`);
    expect(safeGa4PageLocation(new URL(`${prefix}${pathname}a${query}`), false))
      .toBe(`${prefix}${pathname}a`);
    expect(safeGa4PageLocation(new URL(`${prefix}${"a".repeat(1000)}`), false))
      .toBe(prefix);
  });

  it("enables GA4 only for Vercel Production", () => {
    expect(isGa4Production("production")).toBe(true);
    expect(isGa4Production("preview")).toBe(false);
    expect(isGa4Production("development")).toBe(false);
    expect(isGa4Production(undefined)).toBe(false);
  });

  it("uses the approved GA4 measurement ID", () => {
    expect(GA4_MEASUREMENT_ID).toBe("G-RE5Z5B58TJ");
    expect(GA4_DISABLE_WINDOW_KEY).toBe("ga-disable-G-RE5Z5B58TJ");
    expect(GA4_SAFE_PURCHASE_PATH).toBe("/");
    expect(GOOGLE_ADS_PURCHASE_SEND_TO).toBe("AW-592203244/HtL7CMq6qu0bEOybsZoC");
  });

  it("creates the arguments command shape consumed by gtag.js", () => {
    const command = googleTagCommand("event", "conversion", { value: 97.75 });

    expect(Array.isArray(command)).toBe(false);
    expect(Array.from(command)).toEqual(["event", "conversion", { value: 97.75 }]);
  });

  it("blocks private storefront and staff page locations", () => {
    for (const pathname of [
      "/orders/RNR-2026-ABC",
      "/orders/RNR-2026-ABC/proof",
      "/account/orders/RNR-2026-ABC",
      "/checkout",
      "/admin/orders/order-id",
      "/forms",
      "/order-system",
    ]) {
      expect(classifyGa4Location(pathname, new URLSearchParams()), pathname)
        .not.toBe("public");
    }
  });

  it("treats public payment tokens as private locations", () => {
    expect(classifyGa4Location("/pay/private-token", new URLSearchParams())).toBe("private");
  });

  it("treats notification verification tokens as private locations", () => {
    expect(classifyGa4Location(
      "/notification-email/verify/private-verification-token",
      new URLSearchParams(),
    )).toBe("private");
    expect(classifyGa4Location(
      "/notification-email-preferences",
      new URLSearchParams(),
    )).toBe("public");
  });

  it("blocks sensitive query keys even on an otherwise public route", () => {
    for (const query of [
      "access=email-order-token",
      "accessToken=private-camel-access-token",
      "authToken=private-auth-token",
      "checkoutId=private-checkout-id",
      "orderToken=private-order-token",
      "token=password-reset-token",
      "payment_intent_client_secret=private-payment-secret",
      "providerReference=private-provider-reference",
      "signature=private-proof-signature",
      "email=private%40example.test",
    ]) {
      expect(classifyGa4Location("/", new URLSearchParams(query)), query)
        .toBe("private");
    }
  });

  it("allows public catalogue locations and the controlled debug query", () => {
    expect(classifyGa4Location(
      "/products/photo-print-canvas",
      new URLSearchParams("size=a4&ga_debug=1"),
    )).toBe("public");
  });

  it("allows only paid purchase transport on the private order route", () => {
    expect(classifyGa4Location(
      "/orders/RNR-2026-ABC",
      new URLSearchParams("access=private-email-token"),
    )).toBe("private-order");
  });

  it("classifies checkout separately so only allowlisted commerce events can cross the private boundary", () => {
    expect(classifyGa4Location(
      "/checkout",
      new URLSearchParams(),
    )).toBe("private-checkout");
  });
});
