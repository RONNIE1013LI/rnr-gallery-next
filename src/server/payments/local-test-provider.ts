import { createHash, timingSafeEqual } from "node:crypto";
import type { PaymentMethodKey } from "@/server/db/schema/payments";
import { localTestEligibility } from "./eligibility";
import type {
  CompleteProviderReturnInput,
  CreateProviderSessionInput,
  PaymentEligibilityContext,
  PaymentOrder,
  PaymentProvider,
  ProviderAvailability,
  RetrieveProviderPaymentInput,
  VerifiedPaymentResult,
} from "./types";

export type LocalTestProviderOptions = Readonly<{
  method: PaymentMethodKey;
  nodeEnv?: string;
}>;

const localTestConfig = Object.freeze({ enabled: true, isTest: true } as const);
const referencePrefix = "local-test.v1";

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function orderFingerprint(order: PaymentOrder) {
  return JSON.stringify([
    order.id,
    order.orderNumber,
    order.amountCents,
    order.currency,
    order.customer,
    order.billingAddress,
    order.deliveryAddress,
  ]);
}

function providerReference(
  method: PaymentMethodKey,
  attemptId: string,
  order: PaymentOrder,
) {
  const integrity = digest(
    JSON.stringify([referencePrefix, method, attemptId, orderFingerprint(order)]),
  );
  return `${referencePrefix}.${method}.${attemptId}.${integrity}`;
}

function safeEqual(actual: string, expected: string) {
  if (actual.length !== expected.length) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

function parseAttemptId(reference: string, method: PaymentMethodKey) {
  const prefix = `${referencePrefix}.${method}.`;
  if (!reference.startsWith(prefix)) return null;
  const remainder = reference.slice(prefix.length);
  const separator = remainder.lastIndexOf(".");
  if (separator <= 0) return null;
  const attemptId = remainder.slice(0, separator);
  const integrity = remainder.slice(separator + 1);
  if (!attemptId || !/^[a-f0-9]{64}$/.test(integrity)) return null;
  return attemptId;
}

function verifiedResult(
  order: PaymentOrder,
  reference: string,
  status: "processing" | "paid",
): VerifiedPaymentResult {
  return Object.freeze({
    providerReference: reference,
    providerStatus:
      status === "paid" ? "TEST_CAPTURED" : "TEST_REQUIRES_ACTION",
    amountCents: order.amountCents,
    currency: order.currency,
    orderNumber: order.orderNumber,
    status,
  });
}

function assertReference(
  order: PaymentOrder,
  method: PaymentMethodKey,
  reference: string,
) {
  const attemptId = parseAttemptId(reference, method);
  if (!attemptId) throw new Error("Local test return verification failed");
  const expected = providerReference(method, attemptId, order);
  if (!safeEqual(reference, expected)) {
    throw new Error("Local test return verification failed");
  }
}

function availability(
  order: PaymentEligibilityContext,
  method: PaymentMethodKey,
): ProviderAvailability {
  const result = localTestEligibility(order, localTestConfig, method);
  return result.available
    ? Object.freeze({ available: true })
    : Object.freeze({ available: false, reason: result.reason });
}

export function createLocalTestProvider(
  options: LocalTestProviderOptions,
): PaymentProvider {
  if (
    process.env.NODE_ENV === "production" ||
    options.nodeEnv === "production"
  ) {
    throw new Error("Local test payments cannot run in production");
  }

  const { method } = options;
  return Object.freeze({
    key: "local-test" as const,
    method,
    refundCapability: "unsupported" as const,

    async availability(order: PaymentEligibilityContext) {
      return availability(order, method);
    },

    async createOrReuse(input: CreateProviderSessionInput) {
      const methodAvailability = availability(input.order, method);
      if (!methodAvailability.available) {
        throw new Error("Local test payment method is unavailable");
      }

      const reference = providerReference(method, input.attemptId, input.order);
      const url = new URL(input.returnUrl);
      url.searchParams.set("provider", "local-test");
      url.searchParams.set("method", method);
      url.searchParams.set("providerReference", reference);
      url.searchParams.set("state", input.returnState);

      return Object.freeze({
        kind: "test" as const,
        provider: "local-test" as const,
        method,
        providerReference: reference,
        providerStatus: "TEST_REQUIRES_ACTION",
        url: url.toString(),
      });
    },

    async completeReturn(input: CompleteProviderReturnInput) {
      try {
        assertReference(input.order, method, input.providerReference);
        const urlReference = input.returnUrl.searchParams.get("providerReference");
        const urlState = input.returnUrl.searchParams.get("state");
        const urlMethod = input.returnUrl.searchParams.get("method");
        const urlProvider = input.returnUrl.searchParams.get("provider");
        if (
          urlReference !== input.providerReference ||
          urlState !== input.returnState ||
          urlMethod !== method ||
          urlProvider !== "local-test"
        ) {
          throw new Error("invalid return");
        }
      } catch {
        throw new Error("Local test return verification failed");
      }

      return verifiedResult(input.order, input.providerReference, "paid");
    },

    async retrieve(input: RetrieveProviderPaymentInput) {
      assertReference(input.order, method, input.providerReference);
      return verifiedResult(input.order, input.providerReference, "processing");
    },
  });
}
