import { describe, expect, it, vi } from "vitest";
import type { OrderRepository } from "@/server/orders/order-repository";
import {
  OrderConflictError,
  OrderStateChangedError,
} from "@/server/orders/order-service";
import { getCheckoutSessionCookieName, hashCheckoutSessionToken } from "@/server/checkout/session-cookie";
import { ShippingUnavailableError } from "@/server/shipping/shipping-service";
import { createCheckoutOrderRoute } from "./route-handler";
import { serializeAdvertisingConsent } from "@/domain/consent/advertising-consent";
import {
  createWebsiteAnalyticsIdentity,
  WEBSITE_ANALYTICS_SESSION_COOKIE,
  WEBSITE_ANALYTICS_VISITOR_COOKIE,
  websiteAnalyticsVisitorDigest,
} from "@/server/analytics/website-analytics-cookies";

const origin = "https://shop.example.test";
const token = "a".repeat(43);
const sessionId = "10000000-0000-4000-8000-000000000001";
const key = "20000000-0000-4000-8000-000000000001";
const validBody = { idempotencyKey: key, checkoutVersion: 2, cartDigest: "a".repeat(64), shipping: { method: "pickup", serviceCode: "pickup", amountExGstCents: 0, gstCents: 0, amountInclGstCents: 0, isTest: false } } as const;

function request(body: unknown, cookie = token, requestOrigin = origin, customerId: string | null = null) {
  return new Request(`${origin}/api/checkout/order`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: requestOrigin,
      "Sec-Fetch-Site": requestOrigin === origin ? "same-origin" : "cross-site",
      ...(cookie ? { Cookie: `${getCheckoutSessionCookieName(customerId)}=${cookie}` } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function repository(customerId: string | null = null): OrderRepository {
  return {
    findSessionByTokenDigest: vi.fn().mockResolvedValue({
      id: sessionId,
      tokenDigest: hashCheckoutSessionToken(token),
      customerId,
      expiresAt: new Date("2026-09-01T00:00:00.000Z"),
      completedAt: new Date("2026-08-02T12:00:00.000Z"),
    }),
    findBySession: vi.fn(), getCheckoutState: vi.fn(),
    findOwnedUploadIds: vi.fn(), createAtomicOrder: vi.fn(),
  };
}

describe("POST /api/checkout/order", () => {
  it("records the committed order with signed V1 identity and keeps checkout successful when analytics fails", async () => {
    const analyticsSecret = "checkout-analytics-cookie-secret-value-123";
    const at = new Date("2026-08-02T12:00:00.000Z");
    const identity = createWebsiteAnalyticsIdentity(analyticsSecret, at);
    const consent = encodeURIComponent(serializeAdvertisingConsent({
      version: 1,
      analytics: true,
      advertising: false,
      decidedAt: "2026-08-02T11:00:00.000Z",
    }));
    const orderId = "40000000-0000-4000-8000-000000000001";
    const service = { createOrder: vi.fn().mockResolvedValue({
      orderId,
      orderNumber: "RNR-2026-ANALYTICS",
      currency: "NZD",
      totalInclGstCents: 9_775,
      paymentStatus: "awaiting_payment",
    }) };
    const analyticsRecorder = {
      recordWebsiteOrder: vi.fn().mockRejectedValue(new Error("analytics unavailable")),
    };
    const handler = createCheckoutOrderRoute({
      repository: repository(),
      orderService: service,
      getOptionalSession: async () => null,
      trustedOrigin: origin,
      now: () => at,
      analyticsConfig: {
        enabled: true,
        cookieSecret: analyticsSecret,
        v2Enabled: true,
        attributionLookbackDays: 90,
      },
      analyticsRecorder,
    });
    const incoming = new Request(`${origin}/api/checkout/order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        "Sec-Fetch-Site": "same-origin",
        Cookie: [
          `${getCheckoutSessionCookieName(null)}=${token}`,
          `rnr-consent-v1=${consent}`,
          `${WEBSITE_ANALYTICS_VISITOR_COOKIE}=${identity.visitorCookie}`,
          `${WEBSITE_ANALYTICS_SESSION_COOKIE}=${identity.sessionCookie}`,
        ].join("; "),
      },
      body: JSON.stringify(validBody),
    });

    const response = await handler(incoming);

    expect(response.status).toBe(200);
    expect(analyticsRecorder.recordWebsiteOrder).toHaveBeenCalledWith({
      orderId,
      behavioralContext: {
        consentLinked: true,
        visitorDigest: websiteAnalyticsVisitorDigest(identity.visitorId, analyticsSecret),
        convertingSessionId: identity.sessionId,
        isInternal: false,
      },
    });
  });

  it("does not attempt analytics when authoritative order creation fails", async () => {
    const analyticsRecorder = { recordWebsiteOrder: vi.fn() };
    const handler = createCheckoutOrderRoute({
      repository: repository(),
      orderService: { createOrder: vi.fn().mockRejectedValue(new OrderStateChangedError()) },
      getOptionalSession: async () => null,
      trustedOrigin: origin,
      analyticsRecorder,
    });

    expect((await handler(request(validBody))).status).toBe(409);
    expect(analyticsRecorder.recordWebsiteOrder).not.toHaveBeenCalled();
  });

  it("does not store a supplied fbclid without granted advertising consent", async () => {
    const service = { createOrder: vi.fn().mockResolvedValue({
      orderId: "40000000-0000-4000-8000-000000000001", orderNumber: "RNR-2026-NO-META",
      currency: "NZD", totalInclGstCents: 9_775, paymentStatus: "awaiting_payment",
    }) };
    const handler = createCheckoutOrderRoute({ repository: repository(), orderService: service, getOptionalSession: async () => null, trustedOrigin: origin });
    const attribution = {
      utm_source: "facebook",
      gclid: "google-click-1",
      fbclid: "meta-click-1",
    };

    expect((await handler(request({ ...validBody, attribution }))).status).toBe(200);
    expect(service.createOrder).toHaveBeenLastCalledWith(sessionId, key, expect.objectContaining({
      attribution: {
        utm_source: "facebook",
        gclid: "google-click-1",
      },
    }));

    const denied = encodeURIComponent(serializeAdvertisingConsent({
      version: 1,
      analytics: true,
      advertising: false,
      decidedAt: "2026-08-28T00:00:00.000Z",
    }));
    const deniedRequest = new Request(`${origin}/api/checkout/order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        "Sec-Fetch-Site": "same-origin",
        Cookie: `${getCheckoutSessionCookieName(null)}=${token}; rnr-consent-v1=${denied}; _fbp=fb.1.1787900000000.123456789`,
      },
      body: JSON.stringify({ ...validBody, attribution }),
    });
    expect((await handler(deniedRequest)).status).toBe(200);
    expect(service.createOrder).toHaveBeenLastCalledWith(sessionId, key, expect.objectContaining({
      attribution: {
        utm_source: "facebook",
        gclid: "google-click-1",
        measurement: {
          version: 1,
          advertisingConsent: false,
          decidedAt: "2026-08-28T00:00:00.000Z",
        },
      },
    }));
    expect(JSON.stringify(service.createOrder.mock.calls)).not.toContain("meta-click-1");
  });

  it("adds server-read Meta consent and cookies and rejects client forgery", async () => {
    const service = { createOrder: vi.fn().mockResolvedValue({
      orderId: "40000000-0000-4000-8000-000000000001", orderNumber: "RNR-2026-META",
      currency: "NZD", totalInclGstCents: 9_775, paymentStatus: "awaiting_payment",
    }) };
    const handler = createCheckoutOrderRoute({ repository: repository(), orderService: service, getOptionalSession: async () => null, trustedOrigin: origin });
    const consent = encodeURIComponent(serializeAdvertisingConsent({
      version: 1, analytics: false, advertising: true,
      decidedAt: "2026-08-28T00:00:00.000Z",
    }));
    const cookieHeader = `${getCheckoutSessionCookieName(null)}=${token}; rnr-consent-v1=${consent}; _fbp=fb.1.1787900000000.123456789; _fbc=fb.1.1787900000000.click_ABC-123`;
    const metaRequest = new Request(`${origin}/api/checkout/order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json", Origin: origin,
        "Sec-Fetch-Site": "same-origin", Cookie: cookieHeader,
      },
      body: JSON.stringify({ ...validBody, attribution: { utm_source: "facebook", fbclid: "click_ABC-123" } }),
    });

    expect((await handler(metaRequest)).status).toBe(200);
    expect(service.createOrder).toHaveBeenCalledWith(sessionId, key, expect.objectContaining({
      attribution: {
        utm_source: "facebook",
        fbclid: "click_ABC-123",
        measurement: {
          version: 1,
          advertisingConsent: true,
          decidedAt: "2026-08-28T00:00:00.000Z",
          fbp: "fb.1.1787900000000.123456789",
          fbc: "fb.1.1787900000000.click_ABC-123",
        },
      },
    }));
    expect((await handler(request({
      ...validBody,
      attribution: { utm_source: "facebook", measurement: { advertisingConsent: true } },
    }))).status).toBe(400);
  });
  it("binds only allowlisted attribution to the new order", async () => {
    const service = { createOrder: vi.fn().mockResolvedValue({
      orderId: "40000000-0000-4000-8000-000000000001", orderNumber: "RNR-2026-ATTR",
      currency: "NZD", totalInclGstCents: 9_775, paymentStatus: "awaiting_payment",
    }) };
    const handler = createCheckoutOrderRoute({ repository: repository(), orderService: service, getOptionalSession: async () => null, trustedOrigin: origin });
    const attribution = { utm_source: "google", utm_medium: "cpc", gclid: "click-1" };
    expect((await handler(request({ ...validBody, attribution }))).status).toBe(200);
    expect(service.createOrder).toHaveBeenCalledWith(sessionId, key, expect.objectContaining({ attribution }));

    expect((await handler(request({ ...validBody, attribution: { ...attribution, email: "private@example.test" } }))).status).toBe(400);
  });
  it("uses the original completed session and returns only the payment-start DTO", async () => {
    const repo = repository();
    const service = { createOrder: vi.fn().mockResolvedValue({
      orderId: "40000000-0000-4000-8000-000000000001",
      orderNumber: "RNR-2026-ABC12345",
      currency: "NZD",
      totalInclGstCents: 9_775,
      paymentStatus: "awaiting_payment",
      internalId: "must-not-leak",
      providerReference: "must-not-leak",
      attemptId: "must-not-leak",
      secret: "must-not-leak",
      customerEmail: "must-not-leak@example.test",
    }) };
    const handler = createCheckoutOrderRoute({
      repository: repo,
      orderService: service,
      getOptionalSession: async () => null,
      trustedOrigin: origin,
      now: () => new Date("2026-08-02T12:00:00.000Z"),
    });

    const response = await handler(request(validBody));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(repo.findSessionByTokenDigest).toHaveBeenCalledWith(
      hashCheckoutSessionToken(token),
      new Date("2026-08-02T12:00:00.000Z"),
    );
    expect(service.createOrder).toHaveBeenCalledWith(sessionId, key, { checkoutVersion: 2, cartDigest: "a".repeat(64), shipping: validBody.shipping });
    expect(await response.json()).toEqual({ order: {
      orderNumber: "RNR-2026-ABC12345",
      currency: "NZD",
      totalInclGstCents: 9_775,
      paymentStatus: "awaiting_payment",
    } });
  });

  it("rejects missing/expired sessions and a wrong signed-in owner", async () => {
    const service = { createOrder: vi.fn() };
    const missing = createCheckoutOrderRoute({
      repository: repository(), orderService: service,
      getOptionalSession: async () => null, trustedOrigin: origin,
    });
    expect((await missing(request(validBody, ""))).status).toBe(401);

    const expiredRepo = repository();
    vi.mocked(expiredRepo.findSessionByTokenDigest).mockResolvedValue(null);
    const expired = createCheckoutOrderRoute({
      repository: expiredRepo, orderService: service,
      getOptionalSession: async () => null, trustedOrigin: origin,
    });
    expect((await expired(request(validBody))).status).toBe(401);

    const foreign = createCheckoutOrderRoute({
      repository: repository("customer-a"), orderService: service,
      getOptionalSession: async () => ({ user: { id: "customer-b" } }),
      trustedOrigin: origin,
    });
    expect((await foreign(request(validBody, token, origin, "customer-b"))).status).toBe(403);
    expect(service.createOrder).not.toHaveBeenCalled();
  });

  it("allows the signed-in owner but never accepts browser authority fields", async () => {
    const service = { createOrder: vi.fn().mockResolvedValue({
      orderId: "40000000-0000-4000-8000-000000000001",
      orderNumber: "RNR-2026-ABC12345", currency: "NZD",
      totalInclGstCents: 7_475, paymentStatus: "awaiting_payment",
    }) };
    const handler = createCheckoutOrderRoute({
      repository: repository("customer-a"), orderService: service,
      getOptionalSession: async () => ({ user: { id: "customer-a" } }),
      trustedOrigin: origin,
    });
    expect((await handler(request(validBody, token, origin, "customer-a"))).status).toBe(200);
    const tampered = await handler(request({ ...validBody, totalInclGstCents: 1 }, token, origin, "customer-a"));
    expect(tampered.status).toBe(400);
  });

  it.each([
    [new OrderConflictError(), 409, "ORDER_CONFLICT"],
    [new OrderStateChangedError(), 409, "CHECKOUT_CHANGED"],
    [new ShippingUnavailableError(), 503, "POST_UNAVAILABLE"],
  ])("maps domain failure to a safe response", async (error, status, code) => {
    const handler = createCheckoutOrderRoute({
      repository: repository(),
      orderService: { createOrder: vi.fn().mockRejectedValue(error) },
      getOptionalSession: async () => null,
      trustedOrigin: origin,
    });
    const response = await handler(request(validBody));
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: { code } });
  });

  it("rejects malformed JSON, invalid keys and cross-site requests", async () => {
    const repo = repository();
    const service = { createOrder: vi.fn() };
    const handler = createCheckoutOrderRoute({
      repository: repo, orderService: service,
      getOptionalSession: async () => null, trustedOrigin: origin,
    });
    for (const invalid of [
      request("{"),
      request({ idempotencyKey: "not-a-uuid" }),
      request({ idempotencyKey: key }, token, "https://attacker.example"),
    ]) {
      expect((await handler(invalid)).status).toBeGreaterThanOrEqual(400);
    }
    expect(repo.findSessionByTokenDigest).not.toHaveBeenCalled();
  });
});
