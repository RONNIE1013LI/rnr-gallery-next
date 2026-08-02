import { describe, expect, it, vi } from "vitest";
import type { OrderRepository } from "@/server/orders/order-repository";
import {
  OrderConflictError,
  OrderStateChangedError,
} from "@/server/orders/order-service";
import { hashCheckoutSessionToken } from "@/server/checkout/session-cookie";
import { ShippingUnavailableError } from "@/server/shipping/shipping-service";
import { createCheckoutOrderRoute } from "./route";

const origin = "https://shop.example.test";
const token = "a".repeat(43);
const sessionId = "10000000-0000-4000-8000-000000000001";
const key = "20000000-0000-4000-8000-000000000001";
const validBody = { idempotencyKey: key, checkoutVersion: 2, cartDigest: "a".repeat(64), shipping: { method: "pickup", serviceCode: "pickup", amountExGstCents: 0, gstCents: 0, amountInclGstCents: 0, isTest: false } } as const;

function request(body: unknown, cookie = token, requestOrigin = origin) {
  return new Request(`${origin}/api/checkout/order`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: requestOrigin,
      "Sec-Fetch-Site": requestOrigin === origin ? "same-origin" : "cross-site",
      ...(cookie ? { Cookie: `rnr_checkout_session=${cookie}` } : {}),
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
      getOptionalSession: async () => ({ user: { id: "signed-in-later" } }),
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
    expect((await foreign(request(validBody))).status).toBe(403);
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
    expect((await handler(request(validBody))).status).toBe(200);
    const tampered = await handler(request({ ...validBody, totalInclGstCents: 1 }));
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
