import Stripe from "stripe";
import type { StripePaymentConfig } from "./config";
import { stripeEligibility } from "./eligibility";
import type {
  PaymentOrder,
  PaymentProvider,
  VerifiedPaymentResult,
} from "./types";

export type StripePaymentIntent = Readonly<{
  id: string;
  amount: number;
  currency: string;
  metadata: Readonly<Record<string, string>>;
  status: string;
  client_secret: string | null;
}>;

export type StripeWebhookEvent = Readonly<{
  id: string;
  type: string;
  data: Readonly<{ object: StripePaymentIntent }>;
}>;

type StripeCreateParams = Readonly<{
  amount: number;
  currency: string;
  payment_method_types: readonly ["card"];
  metadata: Readonly<{ order_number: string }>;
}>;

export type StripeClient = Readonly<{
  paymentIntents: Readonly<{
    create(
      params: StripeCreateParams,
      options: Readonly<{ idempotencyKey: string }>,
    ): Promise<StripePaymentIntent>;
    retrieve(providerReference: string): Promise<StripePaymentIntent>;
  }>;
  webhooks: Readonly<{
    constructEvent(
      rawBody: Uint8Array,
      signature: string,
      secret: string,
    ): StripeWebhookEvent;
  }>;
}>;

type EnabledStripeConfig = Extract<StripePaymentConfig, { enabled: true }>;

function defaultClient(secretKey: string): StripeClient {
  const stripe = new Stripe(secretKey);
  return {
    paymentIntents: {
      create: (params, options) => stripe.paymentIntents.create({
        amount: params.amount,
        currency: params.currency,
        payment_method_types: [...params.payment_method_types],
        metadata: { ...params.metadata },
      }, options),
      retrieve: (providerReference) => stripe.paymentIntents.retrieve(providerReference),
    },
    webhooks: {
      constructEvent: (rawBody, signature, secret) =>
        stripe.webhooks.constructEvent(rawBody, signature, secret) as StripeWebhookEvent,
    },
  };
}

function requestFailure(): Error {
  return new Error("Stripe payment request failed");
}

function verificationFailure(): Error {
  return new Error("Stripe payment verification failed");
}

function assertIntent(
  intent: StripePaymentIntent,
  order: PaymentOrder,
  expectedReference?: string,
) {
  if (
    !intent ||
    typeof intent.id !== "string" ||
    !intent.id.startsWith("pi_") ||
    (expectedReference !== undefined && intent.id !== expectedReference) ||
    !Number.isSafeInteger(intent.amount) ||
    intent.amount !== order.amountCents ||
    intent.currency !== order.currency.toLowerCase() ||
    !intent.metadata ||
    intent.metadata.order_number !== order.orderNumber ||
    typeof intent.status !== "string" ||
    intent.status.length === 0
  ) throw verificationFailure();
}

function verifiedStatus(status: string): VerifiedPaymentResult["status"] {
  if (status === "succeeded") return "paid";
  if (status === "requires_payment_method") return "failed";
  if (status === "canceled") return "cancelled";
  return "processing";
}

function verifiedResult(
  intent: StripePaymentIntent,
  order: PaymentOrder,
): VerifiedPaymentResult {
  const status = verifiedStatus(intent.status);
  return Object.freeze({
    providerReference: intent.id,
    providerStatus: intent.status,
    amountCents: order.amountCents,
    currency: order.currency,
    orderNumber: order.orderNumber,
    status,
    ...(status === "failed" ? { sanitizedFailureCode: "payment_method_required" } : {}),
  });
}

const webhookStatuses = Object.freeze({
  "payment_intent.succeeded": Object.freeze({ providerStatus: "succeeded", status: "paid" }),
  "payment_intent.processing": Object.freeze({ providerStatus: "processing", status: "processing" }),
  "payment_intent.payment_failed": Object.freeze({
    providerStatus: "requires_payment_method",
    status: "failed",
  }),
  "payment_intent.canceled": Object.freeze({ providerStatus: "canceled", status: "cancelled" }),
} satisfies Readonly<Record<string, Readonly<{
  providerStatus: string;
  status: VerifiedPaymentResult["status"];
}>>>);

function verifiedWebhookResult(
  event: StripeWebhookEvent,
  config: EnabledStripeConfig,
) {
  const mapping = webhookStatuses[event.type as keyof typeof webhookStatuses];
  const intent = event.data?.object;
  const currency = intent?.currency?.toUpperCase();
  const orderNumber = intent?.metadata?.order_number;
  if (
    typeof event.id !== "string" ||
    !event.id.startsWith("evt_") ||
    !mapping ||
    !intent ||
    typeof intent.id !== "string" ||
    !intent.id.startsWith("pi_") ||
    !Number.isSafeInteger(intent.amount) ||
    intent.amount <= 0 ||
    !config.supportedCurrencies.includes(currency as VerifiedPaymentResult["currency"]) ||
    typeof orderNumber !== "string" ||
    orderNumber.length === 0 ||
    orderNumber !== orderNumber.trim() ||
    intent.status !== mapping.providerStatus
  ) {
    throw verificationFailure();
  }
  const result: VerifiedPaymentResult = Object.freeze({
    providerReference: intent.id,
    providerStatus: intent.status,
    amountCents: intent.amount,
    currency: currency as VerifiedPaymentResult["currency"],
    orderNumber,
    status: mapping.status,
    ...(mapping.status === "failed"
      ? { sanitizedFailureCode: "payment_method_required" }
      : {}),
  });
  return Object.freeze({
    provider: "stripe" as const,
    providerEventId: event.id,
    result,
  });
}

export function createStripeProvider({
  config,
  client = defaultClient(config.secretKey),
}: {
  config: EnabledStripeConfig;
  client?: StripeClient;
}): PaymentProvider {
  async function retrieve(order: PaymentOrder, providerReference: string) {
    let intent: StripePaymentIntent;
    try {
      intent = await client.paymentIntents.retrieve(providerReference);
    } catch {
      throw requestFailure();
    }
    assertIntent(intent, order, providerReference);
    return verifiedResult(intent, order);
  }

  const provider: PaymentProvider = {
    key: "stripe" as const,
    method: "card" as const,
    refundCapability: "unsupported" as const,

    async availability(order) {
      return stripeEligibility(order, config);
    },

    async createOrReuse(input) {
      if (!stripeEligibility(input.order, config).available) {
        throw verificationFailure();
      }
      let intent: StripePaymentIntent;
      try {
        intent = await client.paymentIntents.create({
          amount: input.order.amountCents,
          currency: input.order.currency.toLowerCase(),
          payment_method_types: ["card"],
          metadata: { order_number: input.order.orderNumber },
        }, { idempotencyKey: input.idempotencyKey });
      } catch {
        throw requestFailure();
      }
      assertIntent(intent, input.order);
      if (typeof intent.client_secret !== "string" || intent.client_secret.length === 0) {
        throw verificationFailure();
      }
      return Object.freeze({
        kind: "elements" as const,
        provider: "stripe" as const,
        method: "card" as const,
        providerReference: intent.id,
        providerStatus: intent.status,
        clientSecret: intent.client_secret,
        returnUrl: input.returnUrl,
      });
    },

    async completeReturn(input) {
      return retrieve(input.order, input.providerReference);
    },

    async retrieve(input) {
      return retrieve(input.order, input.providerReference);
    },

    async verifyWebhook(rawBody, headers) {
      const signature = headers.get("stripe-signature");
      if (!signature) throw verificationFailure();
      try {
        const event = client.webhooks.constructEvent(
          rawBody,
          signature,
          config.webhookSecret,
        );
        return verifiedWebhookResult(event, config);
      } catch {
        throw verificationFailure();
      }
    },
  };
  return Object.freeze(provider);
}
