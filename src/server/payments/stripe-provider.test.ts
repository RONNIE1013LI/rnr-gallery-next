import { describe, expect, it, vi } from "vitest";
import type { NormalizedAddress } from "@/domain/address/types";
import type { StripePaymentConfig } from "./config";
import {
  createStripeProvider,
  type StripeClient,
  type StripePaymentIntent,
} from "./stripe-provider";
import type { CreateProviderSessionInput, PaymentOrder } from "./types";

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

function client(intent: StripePaymentIntent = baseIntent): StripeClient {
  return {
    paymentIntents: {
      create: vi.fn().mockResolvedValue(intent),
      retrieve: vi.fn().mockResolvedValue(intent),
    },
  };
}

describe("Stripe payment provider", () => {
  it("creates one explicit card PaymentIntent with exact immutable authority", async () => {
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

  it("uses the same provider idempotency key when createOrReuse is replayed", async () => {
    const stripe = client();
    const provider = createStripeProvider({ config, client: stripe });

    await provider.createOrReuse(sessionInput);
    await provider.createOrReuse(sessionInput);

    expect(stripe.paymentIntents.create).toHaveBeenCalledTimes(2);
    expect(vi.mocked(stripe.paymentIntents.create).mock.calls[1]?.[1])
      .toEqual({ idempotencyKey: sessionInput.idempotencyKey });
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
        providerReference: baseIntent.id,
        providerStatus: stripeStatus,
        amountCents: order.amountCents,
        currency: order.currency,
        orderNumber: order.orderNumber,
        status,
      });
    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith(baseIntent.id);
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
});
