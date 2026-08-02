import { createHash } from "node:crypto";
import type { PaymentMethodKey } from "@/server/db/schema/payments";
import type { ReviewedPaymentCheckoutRepository } from "@/server/checkout/checkout-repository";
import { parsePaymentReturnOrigin } from "./config";
import type {
  PaymentOrderAccess,
  PaymentRepository,
} from "./payment-repository";
import type { PaymentProviderRegistration } from "./provider-registry";
import {
  toImmediatePaymentActionDTO,
  toPublicPaymentDTO,
  type PaymentActionDTO,
  type PublicPaymentDTO,
} from "./public-dto";
import type {
  PaymentEligibilityContext,
  PaymentProvider,
  ProviderSession,
} from "./types";

export type PaymentServiceErrorCode =
  | "CHECKOUT_CHANGED"
  | "ORDER_NOT_FOUND"
  | "PAYMENT_UNAVAILABLE"
  | "PAYMENT_ATTEMPT_IN_PROGRESS";

export class PaymentServiceError extends Error {
  constructor(
    public readonly code: PaymentServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PaymentServiceError";
  }
}

export type ReviewedPaymentAccess = Readonly<{
  sessionId: string;
  checkoutVersion: number;
  cartDigest: string;
}>;

export type PublicPaymentMethod = Readonly<{
  method: PaymentMethodKey;
  label: string;
  isTest: boolean;
}>;

export type PaymentStartResult = Readonly<{
  payment: PublicPaymentDTO;
  action: PaymentActionDTO | null;
}>;

type CheckoutPaymentAuthority = ReviewedPaymentCheckoutRepository;

type ReturnStateSeed = Readonly<{
  attemptId: string;
  idempotencyKey: string;
  provider: string;
  method: string;
}>;

function defaultReturnState(seed: ReturnStateSeed) {
  return createHash("sha256")
    .update([
      "rnr-return-state:v1",
      seed.attemptId,
      seed.provider,
      seed.method,
      seed.idempotencyKey,
    ].join(":"), "utf8")
    .digest("hex");
}

function digestReturnState(rawState: string) {
  return createHash("sha256").update(rawState, "utf8").digest("hex");
}

function trustedPaymentUrl(
  origin: string,
  provider: PaymentProvider["key"],
  action: "return" | "cancel",
  orderNumber: string,
  method: PaymentMethodKey,
  returnState: string,
) {
  const url = new URL(`/api/payments/returns/${provider}`, origin);
  url.searchParams.set("flow", action);
  url.searchParams.set("orderNumber", orderNumber);
  url.searchParams.set("method", method);
  url.searchParams.set("state", returnState);
  return url.toString();
}

function unavailableStart(): PaymentServiceError {
  return new PaymentServiceError(
    "PAYMENT_UNAVAILABLE",
    "Payment could not be started",
  );
}

function expectedSessionKind(provider: PaymentProvider["key"]): ProviderSession["kind"] {
  if (provider === "local-test") return "test";
  if (provider === "stripe") return "elements";
  return "redirect";
}

function hasExpectedIdentity(
  session: ProviderSession,
  provider: PaymentProvider,
  method: PaymentMethodKey,
) {
  return session.provider === provider.key &&
    session.method === method &&
    session.kind === expectedSessionKind(provider.key);
}

function publicPayment(
  method: PaymentMethodKey,
  status: PublicPaymentDTO["status"],
  isTest: boolean,
) {
  return toPublicPaymentDTO({ method, status, isTest });
}

export function createPaymentService({
  repository,
  checkoutAuthority,
  providers,
  returnBaseUrl,
  deriveReturnState = defaultReturnState,
  nodeEnv = process.env.NODE_ENV,
}: {
  repository: PaymentRepository;
  checkoutAuthority: CheckoutPaymentAuthority;
  providers: readonly PaymentProviderRegistration[];
  returnBaseUrl: string;
  deriveReturnState?: (input: ReturnStateSeed) => string;
  nodeEnv?: string;
}) {
  const trustedOrigin = parsePaymentReturnOrigin(returnBaseUrl, nodeEnv);
  if (!trustedOrigin) {
    throw new Error("Payment return base URL is invalid");
  }
  const byMethod = new Map(providers.map((entry) => [entry.method, entry]));

  return {
    async availableMethods(
      access: ReviewedPaymentAccess,
    ): Promise<readonly PublicPaymentMethod[]> {
      const context = await checkoutAuthority.findReviewedPaymentContext(access);
      if (!context) {
        throw new PaymentServiceError(
          "CHECKOUT_CHANGED",
          "The checkout has changed; review it again",
        );
      }
      const results = await Promise.all(providers.map(async (entry) => {
        try {
          return { entry, availability: await entry.provider.availability(context) };
        } catch {
          return { entry, availability: { available: false as const, reason: "provider" } };
        }
      }));
      return Object.freeze(results
        .filter(({ availability }) => availability.available)
        .map(({ entry }) => Object.freeze({
          method: entry.method,
          label: entry.label,
          isTest: entry.isTest,
        })));
    },

    async start(
      access: PaymentOrderAccess,
      method: PaymentMethodKey,
      clientKey: string,
    ): Promise<PaymentStartResult> {
      const order = await repository.findPayableOrder(access);
      if (!order) {
        throw new PaymentServiceError("ORDER_NOT_FOUND", "Order is unavailable");
      }
      const registration = byMethod.get(method);
      if (!registration) {
        throw new PaymentServiceError(
          "PAYMENT_UNAVAILABLE",
          "Payment method is unavailable",
        );
      }
      let methodAvailability;
      try {
        methodAvailability = await registration.provider.availability(
          order satisfies PaymentEligibilityContext,
        );
      } catch {
        throw unavailableStart();
      }
      if (!methodAvailability.available) {
        throw new PaymentServiceError(
          "PAYMENT_UNAVAILABLE",
          "Payment method is unavailable",
        );
      }

      const claim = await repository.createOrClaimNonterminalAttempt({
        orderId: order.id,
        provider: registration.provider.key,
        method,
        expectedAmountCents: order.amountCents,
        currency: "NZD",
        clientKey,
      });
      if (claim.outcome === "existing_conflict") {
        throw new PaymentServiceError(
          "PAYMENT_ATTEMPT_IN_PROGRESS",
          "Another payment attempt is in progress",
        );
      }
      if (claim.outcome === "existing" || !claim.claimId) {
        return Object.freeze({
          payment: publicPayment(method, claim.attempt.status, registration.isTest),
          action: null,
        });
      }

      let returnState: string;
      let session: ProviderSession;
      try {
        returnState = deriveReturnState({
          attemptId: claim.attempt.id,
          idempotencyKey: claim.attempt.idempotencyKey,
          provider: registration.provider.key,
          method,
        });
        if (!/^[a-f0-9]{64}$/.test(returnState)) throw new Error("Invalid return state");
        session = await registration.provider.createOrReuse({
          order,
          attemptId: claim.attempt.id,
          idempotencyKey: claim.attempt.idempotencyKey,
          returnState,
          returnUrl: trustedPaymentUrl(
            trustedOrigin,
            registration.provider.key,
            "return",
            order.orderNumber,
            method,
            returnState,
          ),
          cancelUrl: trustedPaymentUrl(
            trustedOrigin,
            registration.provider.key,
            "cancel",
            order.orderNumber,
            method,
            returnState,
          ),
        });
        if (!hasExpectedIdentity(session, registration.provider, method)) {
          throw new Error("Payment provider identity mismatch");
        }
      } catch {
        throw unavailableStart();
      }
      const status = session.kind === "elements" ? "processing" : "requires_action";
      try {
        await repository.bindProviderSession({
          attemptId: claim.attempt.id,
          claimId: claim.claimId,
          providerReference: session.providerReference,
          returnStateDigest: digestReturnState(returnState),
          status,
        });
      } catch {
        throw unavailableStart();
      }
      return Object.freeze({
        payment: publicPayment(method, status, registration.isTest),
        action: toImmediatePaymentActionDTO(session),
      });
    },
  };
}
