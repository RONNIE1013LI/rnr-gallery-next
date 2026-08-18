import { describe, expect, it, vi } from "vitest";
import type { NormalizedAddress } from "@/domain/address/types";
import type { StripePaymentConfig } from "./config";
import {
  createStripeProvider,
  type StripeClient,
  type StripeCharge,
  type StripePaymentIntent,
  type StripeWebhookEvent,
} from "./stripe-provider";
import type {
  CreateProviderSessionInput,
  PaymentOrder,
  PaymentTargetSnapshot,
} from "./types";

const address: NormalizedAddress = {
  country: "NZ",
  fullName: "Aroha Ngata",
  building: "",
  street: "1 Test Street",
  suburb: "Auckland Central",
  region: "Auckland",
  postcode: "1010",
  phone: "+64210000000",
  email: "aroha@example.test",
};
const order: PaymentOrder = {
  id: "order-id",
  orderNumber: "RNR-2026-ABC",
  amountCents: 12_075,
  currency: "NZD",
  customer: { fullName: address.fullName, email: address.email, phone: address.phone },
  billingAddress: address,
  deliveryAddress: address,
};
const config: Extract<StripePaymentConfig, { enabled: true }> = {
  enabled: true,
  secretKey: "sk_test_not_real",
  publishableKey: "pk_test_not_real",
  webhookSecret: "whsec_not_real",
  supportedCurrencies: ["NZD", "AUD"],
};
const baseIntent: StripePaymentIntent = {
  id: "pi_test_123",
  amount: order.amountCents,
  currency: "nzd",
  metadata: { order_number: order.orderNumber },
  status: "requires_action",
  client_secret: "pi_test_123_secret_client",
};
const sessionInput: CreateProviderSessionInput = {
  order,
  attemptId: "attempt-id",
  idempotencyKey: "stable-attempt-derived-key",
  returnState: "a".repeat(64),
  returnUrl: "https://shop.example.test/api/payments/returns/stripe?state=safe",
  cancelUrl: "https://shop.example.test/api/payments/returns/stripe?flow=cancel&state=safe",
};

function webhookEvent(
  type = "payment_intent.succeeded",
  intent: StripePaymentIntent = { ...baseIntent, status: "succeeded", client_secret: null },
): StripeWebhookEvent {
  return { id: "evt_exact_123", type, data: { object: intent } };
}

function client(
  intent: StripePaymentIntent = baseIntent,
  event: StripeWebhookEvent = webhookEvent(),
): StripeClient {
  return {
    paymentIntents: {
      create: vi.fn().mockResolvedValue(intent),
      retrieve: vi.fn().mockResolvedValue(intent),
    },
    webhooks: {
      constructEvent: vi.fn().mockReturnValue(event),
    },
  };
}

describe("Stripe payment provider", () => {
  it("bounds the production default SDK network budget below the reconciliation lease", async () => {
    const StripeConstructor = vi.fn(function StripeConstructor() {
      return client();
    });
    vi.resetModules();
    vi.doMock("stripe", () => ({ default: StripeConstructor }));

    try {
      const { createStripeProvider: createProviderWithDefaultClient } =
        await import("./stripe-provider");
      const provider = createProviderWithDefaultClient({ config });

      await expect(provider.createOrReuse(sessionInput)).resolves.toMatchObject({
        kind: "elements",
        provider: "stripe",
      });

      expect(StripeConstructor).toHaveBeenCalledWith(config.secretKey, {
        timeout: 10_000,
        maxNetworkRetries: 1,
      });
    } finally {
      vi.doUnmock("stripe");
      vi.resetModules();
    }
  });

  it("creates one card-only Stripe PaymentIntent without automatic methods", async () => {
    const stripe = client();
    const provider = createStripeProvider({ config, client: stripe });

    await expect(provider.availability(order)).resolves.toEqual({ available: true });
    await expect(provider.createOrReuse(sessionInput)).resolves.toEqual({
      kind: "elements",
      provider: "stripe",
      method: "card",
      providerReference: baseIntent.id,
      providerStatus: "requires_action",
      clientSecret: baseIntent.client_secret,
      returnUrl: sessionInput.returnUrl,
    });
    expect(stripe.paymentIntents.create).toHaveBeenCalledWith({
      amount: order.amountCents,
      currency: "nzd",
      payment_method_types: ["card"],
      metadata: { order_number: order.orderNumber },
    }, { idempotencyKey: sessionInput.idempotencyKey });
    expect(vi.mocked(stripe.paymentIntents.create).mock.calls[0]?.[0])
      .not.toHaveProperty("automatic_payment_methods");
  });

  it("creates a fixed Payment Request intent using its merchant reference", async () => {
    const target: PaymentTargetSnapshot = {
      targetKind: "payment_request",
      targetId: "request-id",
      merchantReference: "PAY-08001",
      amountCents: 20_000,
      currency: "NZD",
      customer: {
        fullName: "Aroha Ngata",
        email: "aroha@example.test",
        phone: "",
      },
      billingAddress: null,
      deliveryAddress: null,
    };
    const intent: StripePaymentIntent = {
      ...baseIntent,
      amount: target.amountCents,
      metadata: { merchant_reference: target.merchantReference },
    };
    const stripe = client(intent);
    const provider = createStripeProvider({ config, client: stripe });

    await expect(provider.createOrReuse({ ...sessionInput, order: target }))
      .resolves.toMatchObject({ providerReference: intent.id });
    expect(stripe.paymentIntents.create).toHaveBeenCalledWith({
      amount: 20_000,
      currency: "nzd",
      payment_method_types: ["card"],
      metadata: { merchant_reference: "PAY-08001" },
    }, { idempotencyKey: sessionInput.idempotencyKey });
    expect(vi.mocked(stripe.paymentIntents.create).mock.calls[0]?.[0])
      .not.toHaveProperty("quantity");
  });

  it("sends the authoritative stored Australian Banner Bundle total in AUD", async () => {
    const australianAddress: NormalizedAddress = {
      ...address,
      country: "AU",
      region: "NSW",
      postcode: "2000",
      phone: "+61400000000",
    };
    const australianOrder: PaymentOrder = {
      ...order,
      amountCents: 33_999,
      currency: "AUD",
      customer: {
        fullName: australianAddress.fullName,
        email: australianAddress.email,
        phone: australianAddress.phone,
      },
      billingAddress: australianAddress,
      deliveryAddress: australianAddress,
    };
    const australianIntent: StripePaymentIntent = {
      ...baseIntent,
      amount: australianOrder.amountCents,
      currency: "aud",
      metadata: { order_number: australianOrder.orderNumber },
    };
    const stripe = client(australianIntent);
    const provider = createStripeProvider({ config, client: stripe });

    await expect(provider.createOrReuse({ ...sessionInput, order: australianOrder }))
      .resolves.toMatchObject({ providerReference: australianIntent.id });
    expect(stripe.paymentIntents.create).toHaveBeenCalledWith({
      amount: 33_999,
      currency: "aud",
      payment_method_types: ["card"],
      metadata: { order_number: australianOrder.orderNumber },
    }, { idempotencyKey: sessionInput.idempotencyKey });
  });

  it("uses the same provider idempotency key when createOrReuse is replayed", async () => {
    const stripe = client();
    const provider = createStripeProvider({ config, client: stripe });

    await provider.createOrReuse(sessionInput);
    await provider.createOrReuse(sessionInput);

    expect(stripe.paymentIntents.create).toHaveBeenCalledTimes(2);
    expect(vi.mocked(stripe.paymentIntents.create).mock.calls[1]?.[1])
      .toEqual({ idempotencyKey: sessionInput.idempotencyKey });
  });

  it("retrieves a bound PaymentIntent instead of recreating it during payment recovery", async () => {
    const stripe = client();
    const provider = createStripeProvider({ config, client: stripe });

    await expect(provider.createOrReuse({
      ...sessionInput,
      providerReference: baseIntent.id,
    })).resolves.toEqual({
      kind: "elements",
      provider: "stripe",
      method: "card",
      providerReference: baseIntent.id,
      providerStatus: "requires_action",
      clientSecret: baseIntent.client_secret,
      returnUrl: sessionInput.returnUrl,
    });
    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith(baseIntent.id);
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
  });

  it.each([
    ["succeeded", "paid"],
    ["processing", "processing"],
    ["requires_capture", "processing"],
    ["requires_payment_method", "failed"],
    ["canceled", "cancelled"],
    ["requires_confirmation", "processing"],
  ] as const)("maps retrieved %s to verified %s", async (stripeStatus, status) => {
    const stripe = client({ ...baseIntent, status: stripeStatus, client_secret: null });
    const provider = createStripeProvider({ config, client: stripe });

    await expect(provider.retrieve({ order, providerReference: baseIntent.id }))
      .resolves.toMatchObject({
        kind: "verified",
        result: {
          providerReference: baseIntent.id,
          providerStatus: stripeStatus,
          amountCents: order.amountCents,
          currency: order.currency,
          orderNumber: order.orderNumber,
          status,
        },
      });
    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith(baseIntent.id);
  });

  it("verifies a full Stripe charge refund against its original PaymentIntent", async () => {
    const charge: StripeCharge = {
      id: "ch_refunded_123",
      payment_intent: baseIntent.id,
      amount: order.amountCents,
      amount_refunded: order.amountCents,
      currency: "nzd",
      metadata: { order_number: order.orderNumber },
      refunded: true,
    };
    const event: StripeWebhookEvent = {
      id: "evt_refund_123",
      type: "charge.refunded",
      data: { object: charge },
    };
    const provider = createStripeProvider({ config, client: client(baseIntent, event) });

    await expect(provider.verifyWebhook?.(
      new Uint8Array([1, 2, 3]),
      new Headers({ "stripe-signature": "t=1,v1=refund" }),
    )).resolves.toEqual({
      provider: "stripe",
      providerEventId: event.id,
      result: {
        providerReference: baseIntent.id,
        providerStatus: "refunded",
        amountCents: order.amountCents,
        currency: order.currency,
        orderNumber: order.orderNumber,
        status: "refunded",
      },
    });
  });

  it.each([
    ["missing client secret", { ...baseIntent, client_secret: null }],
    ["wrong amount", { ...baseIntent, amount: order.amountCents + 1 }],
    ["wrong currency", { ...baseIntent, currency: "aud" }],
    ["wrong order", { ...baseIntent, metadata: { order_number: "RNR-OTHER" } }],
    ["wrong reference", { ...baseIntent, id: "pi_other" }],
  ])("fails closed for %s", async (_name, intent) => {
    const stripe = client(intent);
    const provider = createStripeProvider({ config, client: stripe });

    if (intent.client_secret === null) {
      await expect(provider.createOrReuse(sessionInput)).rejects.toThrow("Stripe payment verification failed");
    } else {
      await expect(provider.retrieve({ order, providerReference: baseIntent.id }))
        .rejects.toThrow("Stripe payment verification failed");
    }
  });

  it("redacts SDK timeouts and never exposes the provider error", async () => {
    const stripe = client();
    vi.mocked(stripe.paymentIntents.create)
      .mockRejectedValue(new Error("timeout with sk_live_private_value"));
    const provider = createStripeProvider({ config, client: stripe });

    await expect(provider.createOrReuse(sessionInput))
      .rejects.toThrow("Stripe payment request failed");
    await expect(provider.createOrReuse(sessionInput))
      .rejects.not.toThrow("sk_live_private_value");
  });

  it.each([
    ["payment_intent.succeeded", "succeeded", "paid"],
    ["payment_intent.processing", "processing", "processing"],
    ["payment_intent.payment_failed", "requires_payment_method", "failed"],
    ["payment_intent.canceled", "canceled", "cancelled"],
  ] as const)("verifies raw %s events into exact normalized results", async (
    eventType,
    providerStatus,
    status,
  ) => {
    const event = webhookEvent(eventType, {
      ...baseIntent,
      status: providerStatus,
      client_secret: null,
    });
    const stripe = client(baseIntent, event);
    const provider = createStripeProvider({ config, client: stripe });
    const rawBody = new Uint8Array([0, 255, 13, 10, 123, 125]);
    const headers = new Headers({ "stripe-signature": "t=1,v1=exact" });

    await expect(provider.verifyWebhook?.(rawBody, headers)).resolves.toEqual({
      provider: "stripe",
      providerEventId: event.id,
      result: {
        providerReference: baseIntent.id,
        providerStatus,
        amountCents: order.amountCents,
        currency: order.currency,
        orderNumber: order.orderNumber,
        status,
        ...(status === "failed" ? { sanitizedFailureCode: "payment_method_required" } : {}),
      },
    });
    expect(stripe.webhooks.constructEvent).toHaveBeenCalledWith(
      rawBody,
      "t=1,v1=exact",
      config.webhookSecret,
    );
    expect(vi.mocked(stripe.webhooks.constructEvent).mock.calls[0]?.[0]).toBe(rawBody);
  });

  it("preserves the Payment Request merchant reference from a verified webhook", async () => {
    const intent: StripePaymentIntent = {
      ...baseIntent,
      status: "succeeded",
      client_secret: null,
      amount: 20_000,
      metadata: { merchant_reference: "PAY-08001" },
    };
    const event = webhookEvent("payment_intent.succeeded", intent);
    const provider = createStripeProvider({ config, client: client(intent, event) });

    await expect(provider.verifyWebhook?.(
      new Uint8Array([1, 2, 3]),
      new Headers({ "stripe-signature": "t=1,v1=request" }),
    )).resolves.toMatchObject({
      result: {
        providerReference: intent.id,
        amountCents: 20_000,
        currency: "NZD",
        merchantReference: "PAY-08001",
        status: "paid",
      },
    });
  });

  it.each([
    ["missing signature", new Headers(), webhookEvent()],
    ["unsupported event", new Headers({ "stripe-signature": "valid" }), webhookEvent("charge.succeeded")],
    ["event/status mismatch", new Headers({ "stripe-signature": "valid" }), webhookEvent(
      "payment_intent.succeeded",
      { ...baseIntent, status: "processing", client_secret: null },
    )],
    ["invalid event id", new Headers({ "stripe-signature": "valid" }), { ...webhookEvent(), id: "" }],
    ["invalid intent reference", new Headers({ "stripe-signature": "valid" }), webhookEvent(
      "payment_intent.succeeded",
      { ...baseIntent, id: "bad", status: "succeeded", client_secret: null },
    )],
    ["invalid amount", new Headers({ "stripe-signature": "valid" }), webhookEvent(
      "payment_intent.succeeded",
      { ...baseIntent, amount: -1, status: "succeeded", client_secret: null },
    )],
    ["invalid currency", new Headers({ "stripe-signature": "valid" }), webhookEvent(
      "payment_intent.succeeded",
      { ...baseIntent, currency: "btc", status: "succeeded", client_secret: null },
    )],
    ["missing order metadata", new Headers({ "stripe-signature": "valid" }), webhookEvent(
      "payment_intent.succeeded",
      { ...baseIntent, metadata: {}, status: "succeeded", client_secret: null },
    )],
  ])("fails closed for %s webhook input", async (_name, headers, event) => {
    const stripe = client(baseIntent, event as StripeWebhookEvent);
    const provider = createStripeProvider({ config, client: stripe });

    await expect(provider.verifyWebhook?.(new Uint8Array([123, 125]), headers))
      .rejects.toThrow("Stripe payment verification failed");
  });

  it("redacts signature verification errors, secrets, and raw bodies", async () => {
    const stripe = client();
    vi.mocked(stripe.webhooks.constructEvent).mockImplementation(() => {
      throw new Error("bad whsec_private {customer-secret-body}");
    });
    const provider = createStripeProvider({ config, client: stripe });

    const verification = provider.verifyWebhook?.(
      new TextEncoder().encode("{customer-secret-body}"),
      new Headers({ "stripe-signature": "private-signature" }),
    );
    await expect(verification).rejects.toThrow("Stripe payment verification failed");
    await expect(verification).rejects.not.toThrow(/whsec|customer-secret|private-signature/);
  });
});
