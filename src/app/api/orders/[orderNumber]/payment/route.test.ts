import { describe, expect, it, vi } from "vitest";
import { getCheckoutSessionCookieName, hashCheckoutSessionToken } from "@/server/checkout/session-cookie";
import { PaymentServiceError } from "@/server/payments/payment-service";
import { createOrderPaymentMethodsRoute, createOrderPaymentRoute } from "./route-handler";

const origin = "https://shop.example.test";
const token = "a".repeat(43);
const orderNumber = "RNR-2026-PAY1001";
const paymentKey = "10000000-0000-4000-8000-000000000001";
const validBody = { method: "card", idempotencyKey: paymentKey };

function request(body: unknown, cookie = token, requestOrigin = origin) {
  return new Request(`${origin}/api/orders/${orderNumber}/payment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: requestOrigin,
      "Sec-Fetch-Site": requestOrigin === origin ? "same-origin" : "cross-site",
      ...(cookie ? { Cookie: `rnr_checkout_session_guest=${cookie}` } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const context = { params: Promise.resolve({ orderNumber }) };

describe("POST /api/orders/[orderNumber]/payment", () => {
  it("starts an owner-scoped guest payment and explicitly serializes a safe action", async () => {
    const paymentService = {
      changePaymentMethod: vi.fn(), confirmPayment: vi.fn(), start: vi.fn().mockResolvedValue({
      payment: {
        method: "card", status: "requires_action", isTest: true, canRetry: false,
        attemptId: "internal", providerReference: "internal", providerError: "internal",
      },
      action: {
        kind: "test", method: "card", redirectUrl: "https://trusted.example/pay",
        isTest: true, orderId: "internal", claimId: "internal", providerStatus: "internal",
      },
      idempotencyKey: "internal",
    }) };
    const handler = createOrderPaymentRoute({
      paymentService,
      getOptionalSession: async () => null,
      trustedOrigin: origin,
    });
    const response = await handler(request(validBody), context);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(paymentService.start).toHaveBeenCalledWith({
      kind: "guest", orderNumber, tokenDigest: hashCheckoutSessionToken(token),
    }, "card", paymentKey);
    expect(await response.json()).toEqual({
      payment: { method: "card", status: "requires_action", isTest: true, canRetry: false },
      action: { kind: "test", method: "card", redirectUrl: "https://trusted.example/pay", isTest: true },
    });
  });

  it("confirms the current owned attempt without accepting provider authority from the browser", async () => {
    const paymentService = {
      changePaymentMethod: vi.fn(),
      start: vi.fn(),
      confirmPayment: vi.fn().mockResolvedValue({
        payment: { method: "card", status: "paid", isTest: false, canRetry: false },
        orderNumber,
      }),
    };
    const handler = createOrderPaymentRoute({
      paymentService,
      getOptionalSession: async () => null,
      trustedOrigin: origin,
    });

    const response = await handler(request({ action: "confirm" }), context);

    expect(response.status).toBe(200);
    expect(paymentService.confirmPayment).toHaveBeenCalledWith({
      kind: "guest", orderNumber, tokenDigest: hashCheckoutSessionToken(token),
    });
    expect(paymentService.start).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({
      payment: { method: "card", status: "paid", isTest: false, canRetry: false },
      orderNumber,
    });
    expect((await handler(request({
      action: "confirm",
      providerReference: "pi_attacker_supplied",
    }), context)).status).toBe(400);
  });

  it("changes payment method using only owner access and server-side authority", async () => {
    const paymentService = {
      start: vi.fn(),
      confirmPayment: vi.fn(),
      changePaymentMethod: vi.fn().mockResolvedValue({
        payment: { method: "afterpay", status: "cancelled", isTest: false, canRetry: true },
        orderNumber,
      }),
    };
    const handler = createOrderPaymentRoute({
      paymentService,
      getOptionalSession: async () => null,
      trustedOrigin: origin,
    });

    const response = await handler(request({ action: "change_method" }), context);

    expect(response.status).toBe(200);
    expect(paymentService.changePaymentMethod).toHaveBeenCalledWith({
      kind: "guest", orderNumber, tokenDigest: hashCheckoutSessionToken(token),
    });
    expect(paymentService.confirmPayment).not.toHaveBeenCalled();
    expect(paymentService.start).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({
      payment: { method: "afterpay", status: "cancelled", isTest: false, canRetry: true },
      orderNumber,
    });
    expect((await handler(request({
      action: "change_method",
      providerReference: "afterpay_attacker_supplied",
    }), context)).status).toBe(400);
  });

  it("uses the signed-in owner without trusting browser owner or order fields", async () => {
    const paymentService = {
      changePaymentMethod: vi.fn(), confirmPayment: vi.fn(), start: vi.fn().mockResolvedValue({
      payment: { method: "afterpay", status: "created", isTest: false, canRetry: false },
      action: null,
    }) };
    const handler = createOrderPaymentRoute({
      paymentService,
      getOptionalSession: async () => ({ user: { id: "customer-a" } }),
      trustedOrigin: origin,
    });
    expect((await handler(request({ method: "afterpay", idempotencyKey: paymentKey }, ""), context)).status)
      .toBe(200);
    expect(paymentService.start).toHaveBeenCalledWith({
      kind: "customer", orderNumber, customerId: "customer-a",
    }, "afterpay", paymentKey);
    for (const field of ["orderId", "amountCents", "currency", "provider", "customerId"]) {
      expect((await handler(request({ ...validBody, [field]: "attacker" }, ""), context)).status)
        .toBe(400);
    }
  });

  it("returns the same generic 404 for missing access or inaccessible orders", async () => {
    const missingAccess = createOrderPaymentRoute({
      paymentService: {
        start: vi.fn(), confirmPayment: vi.fn(), changePaymentMethod: vi.fn(),
      },
      getOptionalSession: async () => null,
      trustedOrigin: origin,
    });
    const noAccessResponse = await missingAccess(request(validBody, ""), context);
    expect(noAccessResponse.status).toBe(404);

    const inaccessible = createOrderPaymentRoute({
      paymentService: {
        changePaymentMethod: vi.fn(),
        confirmPayment: vi.fn(),
        start: vi.fn().mockRejectedValue(
          new PaymentServiceError("ORDER_NOT_FOUND", "Order is unavailable"),
        ),
      },
      getOptionalSession: async () => null,
      trustedOrigin: origin,
    });
    const inaccessibleResponse = await inaccessible(request(validBody), context);
    expect(inaccessibleResponse.status).toBe(404);
    expect(await inaccessibleResponse.json()).toEqual({
      error: { code: "ORDER_NOT_FOUND", message: "Order is unavailable" },
    });
  });

  it("maps unavailable and in-progress payment failures to safe responses", async () => {
    for (const [error, status] of [
      [new PaymentServiceError("PAYMENT_UNAVAILABLE", "Payment method is unavailable"), 503],
      [new PaymentServiceError("PAYMENT_ATTEMPT_IN_PROGRESS", "Another payment is in progress"), 409],
    ] as const) {
      const handler = createOrderPaymentRoute({
        paymentService: {
          changePaymentMethod: vi.fn(),
          confirmPayment: vi.fn(),
          start: vi.fn().mockRejectedValue(error),
        },
        getOptionalSession: async () => null,
        trustedOrigin: origin,
      });
      const response = await handler(request(validBody), context);
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ error: { code: error.code } });
    }
  });

  it("rejects malformed bodies and cross-site requests before service access", async () => {
    const paymentService = {
      start: vi.fn(), confirmPayment: vi.fn(), changePaymentMethod: vi.fn(),
    };
    const handler = createOrderPaymentRoute({
      paymentService, getOptionalSession: async () => null, trustedOrigin: origin,
    });
    for (const invalid of [
      request("{"),
      request({ method: "card", idempotencyKey: "bad" }),
      request({ method: "paypal", idempotencyKey: paymentKey }),
      request(validBody, token, "https://attacker.example"),
    ]) {
      expect((await handler(invalid, context)).status).toBeGreaterThanOrEqual(400);
    }
    expect(paymentService.start).not.toHaveBeenCalled();
  });
});

describe("GET /api/orders/[orderNumber]/payment", () => {
  it("returns only availability-filtered methods for the owner-scoped immutable order", async () => {
    const paymentService = { availableMethodsForOrder: vi.fn().mockResolvedValue([
      { method: "card", label: "Card", isTest: false, provider: "internal" },
    ]) };
    const handler = createOrderPaymentMethodsRoute({
      paymentService,
      getOptionalSession: async () => null,
    });

    const response = await handler(new Request(`${origin}/api/orders/${orderNumber}/payment`, {
      headers: { Cookie: `rnr_checkout_session_guest=${token}` },
    }), context);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(paymentService.availableMethodsForOrder).toHaveBeenCalledWith({
      kind: "guest", orderNumber, tokenDigest: hashCheckoutSessionToken(token),
    });
    expect(await response.json()).toEqual({ methods: [
      { method: "card", label: "Card", isTest: false },
    ] });
  });

  it("uses the signed-in owner fallback and returns the same 404 for no access", async () => {
    const availableMethodsForOrder = vi.fn()
      .mockRejectedValueOnce(new PaymentServiceError("ORDER_NOT_FOUND", "Order is unavailable"))
      .mockResolvedValueOnce([]);
    const owner = createOrderPaymentMethodsRoute({
      paymentService: { availableMethodsForOrder },
      getOptionalSession: async () => ({ user: { id: "customer-a" } }),
    });
    expect((await owner(new Request(`${origin}/api/orders/${orderNumber}/payment`, {
      headers: { Cookie: `${getCheckoutSessionCookieName("customer-a")}=${token}` },
    }), context)).status).toBe(200);
    expect(availableMethodsForOrder).toHaveBeenNthCalledWith(2, {
      kind: "guest", orderNumber, tokenDigest: hashCheckoutSessionToken(token),
    });

    const missing = createOrderPaymentMethodsRoute({
      paymentService: { availableMethodsForOrder: vi.fn() },
      getOptionalSession: async () => null,
    });
    expect((await missing(new Request(`${origin}/api/orders/${orderNumber}/payment`), context)).status).toBe(404);
  });
});
