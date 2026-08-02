import { describe, expect, it, vi } from "vitest";
import { hashCheckoutSessionToken } from "@/server/checkout/session-cookie";
import type { CheckoutStateRepository } from "@/server/checkout/checkout-repository";
import { createCheckoutPaymentMethodsRoute } from "./route";

const origin = "https://shop.example.test";
const token = "a".repeat(43);
const sessionId = "10000000-0000-4000-8000-000000000001";
const validBody = { checkoutVersion: 4, cartDigest: "b".repeat(64) };

function request(body: unknown, cookie = token, requestOrigin = origin) {
  return new Request(`${origin}/api/checkout/payment-methods`, {
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

function repository(customerId: string | null = null) {
  return {
    findActiveSessionByTokenDigest: vi.fn().mockResolvedValue({
      id: sessionId,
      tokenDigest: hashCheckoutSessionToken(token),
      customerId,
      expiresAt: new Date("2026-09-01T00:00:00.000Z"),
    }),
  } as unknown as CheckoutStateRepository;
}

describe("POST /api/checkout/payment-methods", () => {
  it("accepts only version and digest then uses the authorized persisted checkout", async () => {
    const repo = repository();
    const paymentService = { availableMethods: vi.fn().mockResolvedValue([
      {
        method: "card", label: "Test card — no real payment", isTest: true,
        provider: "internal", secret: "must-not-leak",
      },
    ]) };
    const handler = createCheckoutPaymentMethodsRoute({
      repository: repo,
      paymentService,
      getOptionalSession: async () => null,
      trustedOrigin: origin,
      now: () => new Date("2026-08-03T00:00:00.000Z"),
    });

    const response = await handler(request(validBody));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(repo.findActiveSessionByTokenDigest).toHaveBeenCalledWith(
      hashCheckoutSessionToken(token),
      new Date("2026-08-03T00:00:00.000Z"),
    );
    expect(paymentService.availableMethods).toHaveBeenCalledWith({
      sessionId,
      checkoutVersion: 4,
      cartDigest: "b".repeat(64),
    });
    expect(await response.json()).toEqual({ methods: [
      { method: "card", label: "Test card — no real payment", isTest: true },
    ] });
  });

  it("rejects browser payment authority fields and malformed input", async () => {
    const repo = repository();
    const paymentService = { availableMethods: vi.fn() };
    const handler = createCheckoutPaymentMethodsRoute({
      repository: repo,
      paymentService,
      getOptionalSession: async () => null,
      trustedOrigin: origin,
    });
    for (const body of [
      { ...validBody, amountCents: 1 },
      { ...validBody, currency: "AUD" },
      { ...validBody, address: { country: "AU" } },
      { checkoutVersion: 0, cartDigest: "b".repeat(64) },
      { checkoutVersion: 4, cartDigest: "bad" },
      "{",
    ]) {
      expect((await handler(request(body))).status).toBe(400);
    }
    expect(paymentService.availableMethods).not.toHaveBeenCalled();
  });

  it("authorizes guest/customer ownership and rejects missing or foreign sessions", async () => {
    const paymentService = { availableMethods: vi.fn().mockResolvedValue([]) };
    const missing = createCheckoutPaymentMethodsRoute({
      repository: repository(), paymentService,
      getOptionalSession: async () => null, trustedOrigin: origin,
    });
    expect((await missing(request(validBody, ""))).status).toBe(401);

    const foreign = createCheckoutPaymentMethodsRoute({
      repository: repository("customer-a"), paymentService,
      getOptionalSession: async () => ({ user: { id: "customer-b" } }),
      trustedOrigin: origin,
    });
    expect((await foreign(request(validBody))).status).toBe(403);

    const owner = createCheckoutPaymentMethodsRoute({
      repository: repository("customer-a"), paymentService,
      getOptionalSession: async () => ({ user: { id: "customer-a" } }),
      trustedOrigin: origin,
    });
    expect((await owner(request(validBody))).status).toBe(200);
  });

  it("rejects cross-site requests before repository access", async () => {
    const repo = repository();
    const handler = createCheckoutPaymentMethodsRoute({
      repository: repo,
      paymentService: { availableMethods: vi.fn() },
      getOptionalSession: async () => null,
      trustedOrigin: origin,
    });
    expect((await handler(request(validBody, token, "https://attacker.example"))).status)
      .toBe(403);
    expect(repo.findActiveSessionByTokenDigest).not.toHaveBeenCalled();
  });
});
