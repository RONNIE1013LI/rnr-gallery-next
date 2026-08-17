import { describe, expect, it } from "vitest";
import {
  classifyGa4Location,
  GA4_DISABLE_WINDOW_KEY,
  GA4_MEASUREMENT_ID,
  GA4_SAFE_PURCHASE_PATH,
  isGa4Production,
} from "./runtime";

describe("GA4 runtime boundary", () => {
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
