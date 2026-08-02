import { describe, expect, it, vi } from "vitest";
import { PaymentVerificationMismatchError } from "@/server/payments/drizzle-payment-repository";
import type { PaymentProviderRegistration } from "@/server/payments/provider-registry";
import type { PaymentProvider, VerifiedProviderEvent } from "@/server/payments/types";
import { createPaymentWebhookRoute } from "./route";

const url = "https://shop.example.test/api/payments/webhooks/stripe";
const event: VerifiedProviderEvent = {
  provider: "stripe",
  providerEventId: "evt_exact_123",
  result: {
    providerReference: "pi_exact_123",
    providerStatus: "succeeded",
    amountCents: 12_075,
    currency: "NZD",
    orderNumber: "RNR-2026-PAY1001",
    status: "paid",
  },
};

function registration(verifyWebhook = vi.fn().mockResolvedValue(event)) {
  const provider: PaymentProvider = {
    key: "stripe",
    method: "card",
    refundCapability: "unsupported",
    availability: vi.fn(),
    createOrReuse: vi.fn(),
    completeReturn: vi.fn(),
    retrieve: vi.fn(),
    verifyWebhook,
  };
  const stripeRegistration = {
    method: "card",
    label: "Card",
    isTest: false,
    provider,
  } satisfies PaymentProviderRegistration;
  return {
    provider,
    registration: stripeRegistration,
  };
}

function webhookRequest(raw = new Uint8Array([0, 255, 13, 10, 123, 125])) {
  return new Request(url, {
    method: "POST",
    headers: { "stripe-signature": "t=1,v1=exact" },
    body: raw,
  });
}

const stripeContext = { params: Promise.resolve({ provider: "stripe" }) };

describe("POST /api/payments/webhooks/[provider]", () => {
  it("reads the raw body exactly once and verifies it before atomic application", async () => {
    const { provider, registration: stripe } = registration();
    const applyVerifiedWebhook = vi.fn().mockResolvedValue("applied");
    const handler = createPaymentWebhookRoute({
      providers: [stripe],
      paymentService: { applyVerifiedWebhook },
    });
    const request = webhookRequest();
    const arrayBuffer = vi.spyOn(request, "arrayBuffer");
    const jsonBody = vi.spyOn(request, "json");

    const response = await handler(request, stripeContext);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ received: true, result: "applied" });
    expect(arrayBuffer).toHaveBeenCalledTimes(1);
    expect(jsonBody).not.toHaveBeenCalled();
    expect(provider.verifyWebhook).toHaveBeenCalledTimes(1);
    const [verifiedRaw, headers] = vi.mocked(provider.verifyWebhook!).mock.calls[0]!;
    expect([...verifiedRaw]).toEqual([0, 255, 13, 10, 123, 125]);
    expect(headers).toBe(request.headers);
    expect(applyVerifiedWebhook).toHaveBeenCalledWith(event, verifiedRaw);
  });

  it.each(["duplicate" as const])("returns 200 for a same-hash %s without another transition", async (result) => {
    const { registration: stripe } = registration();
    const handler = createPaymentWebhookRoute({
      providers: [stripe],
      paymentService: { applyVerifiedWebhook: vi.fn().mockResolvedValue(result) },
    });

    const response = await handler(webhookRequest(), stripeContext);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, result });
  });

  it("returns 409 only for a reused provider event id with different raw bytes", async () => {
    const { registration: stripe } = registration();
    const handler = createPaymentWebhookRoute({
      providers: [stripe],
      paymentService: { applyVerifiedWebhook: vi.fn().mockResolvedValue("hash_mismatch") },
    });

    const response = await handler(webhookRequest(), stripeContext);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "WEBHOOK_CONFLICT", message: "Webhook event conflicts with stored data" },
    });
  });

  it.each([
    ["signature verification", new Error("private-signature and secret raw body")],
    ["verified order authority", new PaymentVerificationMismatchError()],
  ])("returns a safe 400 for invalid %s", async (_name, failure) => {
    const verifier = vi.fn().mockResolvedValue(event);
    const { registration: stripe } = registration(verifier);
    const applyVerifiedWebhook = vi.fn().mockResolvedValue("applied");
    if (failure instanceof PaymentVerificationMismatchError) {
      applyVerifiedWebhook.mockRejectedValue(failure);
    } else {
      verifier.mockRejectedValue(failure);
    }
    const handler = createPaymentWebhookRoute({
      providers: [stripe],
      paymentService: { applyVerifiedWebhook },
    });

    const response = await handler(webhookRequest(), stripeContext);
    expect(response.status).toBe(400);
    const body = await response.text();
    expect(body).toBe(JSON.stringify({
      error: { code: "INVALID_WEBHOOK", message: "Webhook verification failed" },
    }));
    expect(body).not.toMatch(/private-signature|secret raw body|pi_exact/);
  });

  it("rejects a verifier result for another provider", async () => {
    const { registration: stripe } = registration(vi.fn().mockResolvedValue({
      ...event,
      provider: "afterpay",
    }));
    const applyVerifiedWebhook = vi.fn();
    const handler = createPaymentWebhookRoute({
      providers: [stripe],
      paymentService: { applyVerifiedWebhook },
    });

    expect((await handler(webhookRequest(), stripeContext)).status).toBe(400);
    expect(applyVerifiedWebhook).not.toHaveBeenCalled();
  });

  it.each(["afterpay", "zip", "unknown"])("returns 404 for unsupported %s without reading the body", async (providerName) => {
    const { registration: stripe } = registration();
    const handler = createPaymentWebhookRoute({
      providers: [stripe],
      paymentService: { applyVerifiedWebhook: vi.fn() },
    });
    const request = webhookRequest();
    const arrayBuffer = vi.spyOn(request, "arrayBuffer");

    const response = await handler(request, {
      params: Promise.resolve({ provider: providerName }),
    });
    expect(response.status).toBe(404);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("returns 404 when Stripe is not configured with a verifier", async () => {
    const handler = createPaymentWebhookRoute({
      providers: [],
      paymentService: { applyVerifiedWebhook: vi.fn() },
    });
    const request = webhookRequest();
    const arrayBuffer = vi.spyOn(request, "arrayBuffer");

    expect((await handler(request, stripeContext)).status).toBe(404);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });
});
