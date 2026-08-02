import { describe, expect, it, vi } from "vitest";
import type { CheckoutStateRepository } from "@/server/checkout/checkout-repository";
import { hashCheckoutSessionToken } from "@/server/checkout/session-cookie";
import { ShippingUnavailableError } from "@/server/shipping/shipping-service";
import { createCheckoutShippingRoute } from "./route";

const origin = "https://shop.example.test";
const token = "a".repeat(43);
const sessionId = "10000000-0000-4000-8000-000000000001";

function request(cookie = token, requestOrigin = origin) {
  return new Request(`${origin}/api/checkout/shipping`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: requestOrigin,
      "Sec-Fetch-Site": requestOrigin === origin ? "same-origin" : "cross-site",
      ...(cookie ? { Cookie: `rnr_checkout_session=${cookie}` } : {}),
    },
    body: "{}",
  });
}

function repository(customerId: string | null = null): CheckoutStateRepository {
  return {
    findActiveSessionByTokenDigest: vi.fn().mockResolvedValue({
      id: sessionId,
      tokenDigest: hashCheckoutSessionToken(token),
      customerId,
      expiresAt: new Date("2026-09-01T00:00:00.000Z"),
    }),
    createSession: vi.fn(), deleteEmptySession: vi.fn(), createUpload: vi.fn(),
    findOwnedUploadIds: vi.fn(), saveCheckoutState: vi.fn(), getCheckoutState: vi.fn(),
    clearSelectedShippingQuote: vi.fn(), persistAndSelectShippingQuote: vi.fn(),
  };
}

describe("POST /api/checkout/shipping", () => {
  it("returns the current explicit shipping option with test/live provenance", async () => {
    const service = { quoteShipping: vi.fn().mockResolvedValue({
      selectedQuoteId: "20000000-0000-4000-8000-000000000001",
      option: {
        method: "post", serviceCode: "post", serviceName: "Post",
        amountExGstCents: 2_000, gstCents: 300, amountInclGstCents: 2_300,
        currency: "NZD",
        provenance: "local-test", isTest: true,
        expiresAt: new Date("2026-08-02T12:15:00.000Z"),
      },
    }) };
    const handler = createCheckoutShippingRoute({
      repository: repository(),
      checkoutService: service,
      getOptionalSession: async () => null,
      trustedOrigin: origin,
      now: () => new Date("2026-08-02T12:00:00.000Z"),
    });

    const response = await handler(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({ shipping: { option: {
      method: "post",
      serviceCode: "post",
      serviceName: "Post",
      amountExGstCents: 2_000,
      gstCents: 300,
      amountInclGstCents: 2_300,
      currency: "NZD",
      provenance: "local-test",
      isTest: true,
      expiresAt: "2026-08-02T12:15:00.000Z",
    } } });
    expect(JSON.stringify(body)).not.toContain("selectedQuoteId");
    expect(service.quoteShipping).toHaveBeenCalledWith(sessionId);
  });

  it("rejects a missing cookie and a foreign signed-in owner", async () => {
    const service = { quoteShipping: vi.fn() };
    const missing = createCheckoutShippingRoute({
      repository: repository(), checkoutService: service,
      getOptionalSession: async () => null, trustedOrigin: origin,
    });
    expect((await missing(request(""))).status).toBe(401);

    const foreign = createCheckoutShippingRoute({
      repository: repository("customer-a"), checkoutService: service,
      getOptionalSession: async () => ({ user: { id: "customer-b" } }),
      trustedOrigin: origin,
    });
    expect((await foreign(request())).status).toBe(403);
    expect(service.quoteShipping).not.toHaveBeenCalled();
  });

  it("returns Post unavailable instead of a free or guessed fallback", async () => {
    const handler = createCheckoutShippingRoute({
      repository: repository(),
      checkoutService: {
        quoteShipping: vi.fn().mockRejectedValue(new ShippingUnavailableError()),
      },
      getOptionalSession: async () => null,
      trustedOrigin: origin,
    });
    const response = await handler(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "POST_UNAVAILABLE" },
    });
  });
});
