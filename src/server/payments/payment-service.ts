import { createHash } from "node:crypto";
import type { PaymentMethodKey } from "@/server/db/schema/payments";
import type { ReviewedPaymentCheckoutRepository } from "@/server/checkout/checkout-repository";
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
import type { PaymentEligibilityContext, ProviderSession } from "./types";

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

function returnStateDigest(session: ProviderSession) {
  if (session.kind !== "test") return null;
  const rawState = new URL(session.url).searchParams.get("state");
  if (!rawState) throw new Error("Payment provider did not return state");
  return createHash("sha256").update(rawState, "utf8").digest("hex");
}

function trustedPaymentUrl(
  base: URL,
  action: "return" | "cancel",
  orderNumber: string,
  method: PaymentMethodKey,
) {
  const url = new URL(base.toString());
  url.pathname = `${url.pathname.replace(/\/$/, "")}/${action}`;
  url.search = "";
  url.hash = "";
  url.searchParams.set("orderNumber", orderNumber);
  url.searchParams.set("method", method);
  return url.toString();
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
}: {
  repository: PaymentRepository;
  checkoutAuthority: CheckoutPaymentAuthority;
  providers: readonly PaymentProviderRegistration[];
  returnBaseUrl: string;
}) {
  const trustedBase = new URL(returnBaseUrl);
  if (
    !["http:", "https:"].includes(trustedBase.protocol) ||
    trustedBase.username ||
    trustedBase.password
  ) {
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
      const results = await Promise.all(providers.map(async (entry) => ({
        entry,
        availability: await entry.provider.availability(context),
      })));
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
      const methodAvailability = await registration.provider.availability(
        order satisfies PaymentEligibilityContext,
      );
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

      const session = await registration.provider.createOrReuse({
        order,
        attemptId: claim.attempt.id,
        idempotencyKey: claim.attempt.idempotencyKey,
        returnUrl: trustedPaymentUrl(
          trustedBase,
          "return",
          order.orderNumber,
          method,
        ),
        cancelUrl: trustedPaymentUrl(
          trustedBase,
          "cancel",
          order.orderNumber,
          method,
        ),
      });
      const status = session.kind === "elements" ? "processing" : "requires_action";
      await repository.bindProviderSession({
        attemptId: claim.attempt.id,
        claimId: claim.claimId,
        providerReference: session.providerReference,
        returnStateDigest: returnStateDigest(session),
        status,
      });
      return Object.freeze({
        payment: publicPayment(method, status, registration.isTest),
        action: toImmediatePaymentActionDTO(session),
      });
    },
  };
}
