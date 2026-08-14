import { describe, expect, it, vi } from "vitest";
import { PaymentVerificationMismatchError } from "@/server/payments/drizzle-payment-repository";
import type { PaymentProviderRegistration } from "@/server/payments/provider-registry";
import type { PaymentProvider, VerifiedProviderEvent } from "@/server/payments/types";
import { createPaymentWebhookRoute } from "./route-handler";

const url = "https://shop.example.test/api/payments/webhooks/stripe";
const maxRawBodyBytes = 256 * 1024;
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

function streamingRequest(
  chunks: readonly Uint8Array[],
  headers: Readonly<Record<string, string>> = {},
  cancelError?: Error,
) {
  let index = 0;
  const cancelled = vi.fn(async () => {
    if (cancelError) throw cancelError;
  });
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index++];
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel: cancelled,
  });
  const request = new Request(url, {
    method: "POST",
    headers: { "stripe-signature": "t=1,v1=exact", ...headers },
    body: stream,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  return { request, cancelled };
}

function erroredStreamingRequest() {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error("private stream and body details"));
    },
  });
  const request = new Request(url, {
    method: "POST",
    headers: { "stripe-signature": "private-signature" },
    body: stream,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  return request;
}

const stripeContext = { params: Promise.resolve({ provider: "stripe" }) };

describe("POST /api/payments/webhooks/[provider]", () => {
  it("consumes the raw stream once and verifies exact bytes without arrayBuffer or JSON", async () => {
    const { provider, registration: stripe } = registration();
    const applyVerifiedWebhook = vi.fn().mockResolvedValue("applied");
    const handler = createPaymentWebhookRoute({
      providers: [stripe],
      paymentService: { applyVerifiedWebhook },
    });
    const request = webhookRequest();
    const arrayBuffer = vi.spyOn(request, "arrayBuffer");
    const jsonBody = vi.spyOn(request, "json");
    const getReader = vi.spyOn(request.body!, "getReader");

    const response = await handler(request, stripeContext);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ received: true, result: "applied" });
    expect(getReader).toHaveBeenCalledTimes(1);
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(jsonBody).not.toHaveBeenCalled();
    expect(provider.verifyWebhook).toHaveBeenCalledTimes(1);
    const [verifiedRaw, headers] = vi.mocked(provider.verifyWebhook!).mock.calls[0]!;
    expect([...verifiedRaw]).toEqual([0, 255, 13, 10, 123, 125]);
    expect(headers).toBe(request.headers);
    expect(applyVerifiedWebhook).toHaveBeenCalledWith(event, verifiedRaw);
  });

  it("rejects a declared oversized body before reading or verifying", async () => {
    const { provider, registration: stripe } = registration();
    const applyVerifiedWebhook = vi.fn();
    const handler = createPaymentWebhookRoute({
      providers: [stripe],
      paymentService: { applyVerifiedWebhook },
    });
    const { request, cancelled } = streamingRequest(
      [new Uint8Array([123])],
      { "content-length": String(maxRawBodyBytes + 1) },
      new Error("private cancellation failure"),
    );
    const getReader = vi.spyOn(request.body!, "getReader");

    const response = await handler(request, stripeContext);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: { code: "PAYLOAD_TOO_LARGE", message: "Webhook payload is too large" },
    });
    expect(getReader).not.toHaveBeenCalled();
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(provider.verifyWebhook).not.toHaveBeenCalled();
    expect(applyVerifiedWebhook).not.toHaveBeenCalled();
  });

  it.each([
    ["missing length", {}],
    ["misleading small length", { "content-length": "1" }],
  ])("stops and cancels an oversized %s stream before verification", async (_name, headers) => {
    const { provider, registration: stripe } = registration();
    const applyVerifiedWebhook = vi.fn();
    const handler = createPaymentWebhookRoute({
      providers: [stripe],
      paymentService: { applyVerifiedWebhook },
    });
    const { request, cancelled } = streamingRequest([
      new Uint8Array(maxRawBodyBytes),
      new Uint8Array([1]),
      new Uint8Array([2, 3, 4]),
    ], headers);

    const response = await handler(request, stripeContext);

    expect(response.status).toBe(413);
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(provider.verifyWebhook).not.toHaveBeenCalled();
    expect(applyVerifiedWebhook).not.toHaveBeenCalled();
  });

  it("accepts the exact byte limit and preserves the raw payload", async () => {
    const raw = new Uint8Array(maxRawBodyBytes);
    raw[0] = 17;
    raw[raw.length - 1] = 239;
    const { provider, registration: stripe } = registration();
    const handler = createPaymentWebhookRoute({
      providers: [stripe],
      paymentService: { applyVerifiedWebhook: vi.fn().mockResolvedValue("applied") },
    });
    const { request } = streamingRequest(
      [raw.subarray(0, 100_000), raw.subarray(100_000)],
      { "content-length": String(maxRawBodyBytes) },
    );

    expect((await handler(request, stripeContext)).status).toBe(200);
    const [verifiedRaw] = vi.mocked(provider.verifyWebhook!).mock.calls[0]!;
    expect(verifiedRaw).toHaveLength(maxRawBodyBytes);
    expect(verifiedRaw[0]).toBe(17);
    expect(verifiedRaw[verifiedRaw.length - 1]).toBe(239);
  });

  it("accepts an under-limit chunked body without Content-Length", async () => {
    const { provider, registration: stripe } = registration();
    const handler = createPaymentWebhookRoute({
      providers: [stripe],
      paymentService: { applyVerifiedWebhook: vi.fn().mockResolvedValue("applied") },
    });
    const { request } = streamingRequest([
      new Uint8Array([0, 1]),
      new Uint8Array([2, 255]),
    ]);
    expect(request.headers.has("content-length")).toBe(false);

    expect((await handler(request, stripeContext)).status).toBe(200);
    expect([...vi.mocked(provider.verifyWebhook!).mock.calls[0]![0]])
      .toEqual([0, 1, 2, 255]);
  });

  it("accepts a valid decimal Content-Length with leading zeroes", async () => {
    const { provider, registration: stripe } = registration();
    const handler = createPaymentWebhookRoute({
      providers: [stripe],
      paymentService: { applyVerifiedWebhook: vi.fn().mockResolvedValue("applied") },
    });
    const { request } = streamingRequest(
      [new Uint8Array([0, 1, 2, 255])],
      { "content-length": "000004" },
    );

    expect((await handler(request, stripeContext)).status).toBe(200);
    expect([...vi.mocked(provider.verifyWebhook!).mock.calls[0]![0]])
      .toEqual([0, 1, 2, 255]);
  });

  it.each(["", "-1", "1.5", "abc", "9007199254740992"])(
    "rejects malformed Content-Length %j before reading",
    async (contentLength) => {
      const { provider, registration: stripe } = registration();
      const applyVerifiedWebhook = vi.fn();
      const handler = createPaymentWebhookRoute({
        providers: [stripe],
        paymentService: { applyVerifiedWebhook },
      });
      const { request, cancelled } = streamingRequest(
        [new Uint8Array([123])],
        { "content-length": contentLength },
      );
      const getReader = vi.spyOn(request.body!, "getReader");

      const response = await handler(request, stripeContext);

      expect(response.status).toBe(400);
      expect(getReader).not.toHaveBeenCalled();
      expect(cancelled).toHaveBeenCalledTimes(1);
      expect(provider.verifyWebhook).not.toHaveBeenCalled();
      expect(applyVerifiedWebhook).not.toHaveBeenCalled();
    },
  );

  it("fails safely and releases the reader lock when the request stream errors", async () => {
    const { provider, registration: stripe } = registration();
    const applyVerifiedWebhook = vi.fn();
    const handler = createPaymentWebhookRoute({
      providers: [stripe],
      paymentService: { applyVerifiedWebhook },
    });
    const request = erroredStreamingRequest();

    const response = await handler(request, stripeContext);

    expect(response.status).toBe(400);
    const body = await response.text();
    expect(body).toBe(JSON.stringify({
      error: { code: "INVALID_WEBHOOK", message: "Webhook verification failed" },
    }));
    expect(body).not.toMatch(/private stream|body details|private-signature/);
    expect(request.body?.locked).toBe(false);
    expect(provider.verifyWebhook).not.toHaveBeenCalled();
    expect(applyVerifiedWebhook).not.toHaveBeenCalled();
  });

  it("handles an empty body as a safe verification failure", async () => {
    const verifier = vi.fn().mockRejectedValue(new Error("empty payload"));
    const { registration: stripe } = registration(verifier);
    const applyVerifiedWebhook = vi.fn();
    const handler = createPaymentWebhookRoute({
      providers: [stripe],
      paymentService: { applyVerifiedWebhook },
    });
    const request = new Request(url, {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=invalid" },
    });

    const response = await handler(request, stripeContext);

    expect(response.status).toBe(400);
    expect(verifier).toHaveBeenCalledWith(new Uint8Array(), request.headers);
    expect(applyVerifiedWebhook).not.toHaveBeenCalled();
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
