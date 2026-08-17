import { createHash } from "node:crypto";
import type { NormalizedAddress } from "@/domain/address/types";
import type {
  PaymentMethodKey,
  PaymentProviderKey,
} from "@/server/db/schema/payments";
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
  PaymentOrder,
  PaymentProvider,
  ProviderSession,
  VerifiedPaymentResult,
  VerifiedProviderEvent,
} from "./types";
import {
  PaymentProviderRequestError,
  PaymentProviderVerificationError,
} from "./types";

export type PaymentServiceErrorCode =
  | "CHECKOUT_CHANGED"
  | "ORDER_NOT_FOUND"
  | "PAYMENT_UNAVAILABLE"
  | "PAYMENT_ATTEMPT_IN_PROGRESS"
  | "PAYMENT_RETURN_NOT_FOUND";

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

export type PaymentReturnInput = Readonly<{
  provider: PaymentProviderKey;
  method: PaymentMethodKey;
  orderNumber: string;
  returnState: string;
  providerReference: string;
  returnUrl: URL;
}>;

export type PaymentReturnResult = Readonly<{ orderNumber: string }>;

export type PaymentConfirmationResult = Readonly<{
  payment: PublicPaymentDTO;
  orderNumber: string;
}>;

export type PaymentReconciliationSummary = Readonly<{
  processed: number;
  applied: number;
  retried: number;
  pending: number;
  failed: number;
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

function unavailableReturn(): PaymentServiceError {
  return new PaymentServiceError(
    "PAYMENT_RETURN_NOT_FOUND",
    "Payment return is unavailable",
  );
}

const providerContracts: Readonly<Record<string, Readonly<{
  methods: readonly PaymentMethodKey[];
  sessionKind: ProviderSession["kind"];
  isTest: boolean;
}>>> = Object.freeze({
  "local-test": Object.freeze({
    methods: ["card", "afterpay", "zip"] as readonly PaymentMethodKey[],
    sessionKind: "test",
    isTest: true,
  }),
  stripe: Object.freeze({
    methods: ["card"] as readonly PaymentMethodKey[],
    sessionKind: "elements",
    isTest: false,
  }),
  afterpay: Object.freeze({
    methods: ["afterpay"] as readonly PaymentMethodKey[],
    sessionKind: "redirect",
    isTest: false,
  }),
  zip: Object.freeze({
    methods: ["zip"] as readonly PaymentMethodKey[],
    sessionKind: "redirect",
    isTest: false,
  }),
});

function minimalAddress(address: NormalizedAddress): NormalizedAddress {
  return Object.freeze({
    country: address.country,
    fullName: address.fullName,
    building: address.building,
    street: address.street,
    suburb: address.suburb,
    region: address.region,
    postcode: address.postcode,
    phone: address.phone,
    email: address.email,
  });
}

function eligibilityContext(context: PaymentEligibilityContext): PaymentEligibilityContext {
  return Object.freeze({
    amountCents: context.amountCents,
    currency: context.currency,
    customer: Object.freeze({
      fullName: context.customer.fullName,
      email: context.customer.email,
      phone: context.customer.phone,
    }),
    billingAddress: minimalAddress(context.billingAddress),
    deliveryAddress: minimalAddress(context.deliveryAddress),
  });
}

function providerPaymentOrder(order: PaymentOrder): PaymentOrder {
  return Object.freeze({
    id: order.id,
    orderNumber: order.orderNumber,
    amountCents: order.amountCents,
    currency: order.currency,
    customer: Object.freeze({ ...order.customer }),
    billingAddress: minimalAddress(order.billingAddress),
    deliveryAddress: minimalAddress(order.deliveryAddress),
  });
}

function validateRegistrations(providers: readonly PaymentProviderRegistration[]) {
  const seen = new Set<PaymentMethodKey>();
  for (const entry of providers) {
    if (seen.has(entry.method)) {
      throw new Error(`Duplicate payment method registration: ${entry.method}`);
    }
    seen.add(entry.method);
    const contract = providerContracts[entry.provider.key];
    if (
      !contract ||
      entry.method !== entry.provider.method ||
      !contract.methods.includes(entry.method) ||
      entry.isTest !== contract.isTest
    ) {
      throw new Error(`Invalid payment provider registration: ${entry.method}`);
    }
  }
}

function hasExpectedIdentity(
  session: ProviderSession,
  provider: PaymentProvider,
  method: PaymentMethodKey,
) {
  const contract = providerContracts[provider.key];
  return session.provider === provider.key &&
    session.method === method &&
    session.kind === contract?.sessionKind;
}

function publicPayment(
  method: PaymentMethodKey,
  status: PublicPaymentDTO["status"],
  isTest: boolean,
) {
  return toPublicPaymentDTO({ method, status, isTest });
}

function matchesReconciliationAuthority(
  candidate: Awaited<ReturnType<PaymentRepository["claimReconciliationCandidates"]>>[number],
  result: VerifiedPaymentResult,
) {
  return candidate.attempt.providerReference !== null &&
    result.providerReference === candidate.attempt.providerReference &&
    result.amountCents === candidate.attempt.expectedAmountCents &&
    result.amountCents === candidate.order.amountCents &&
    result.currency === candidate.attempt.currency &&
    result.currency === candidate.order.currency &&
    result.orderNumber === candidate.order.orderNumber;
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
  validateRegistrations(providers);
  const byMethod = new Map(providers.map((entry) => [entry.method, entry]));
  const webhookProviders = new Set(providers
    .filter((entry) => typeof entry.provider.verifyWebhook === "function")
    .map((entry) => entry.provider.key));

  async function methodsForContext(context: PaymentEligibilityContext) {
    const providerContext = eligibilityContext(context);
    const results = await Promise.all(providers.map(async (entry) => {
      try {
        return {
          entry,
          availability: await entry.provider.availability(providerContext),
        };
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
  }

  return {
    async changePaymentMethod(
      access: PaymentOrderAccess,
    ): Promise<PaymentConfirmationResult> {
      const current = await repository.findCurrentPayment(access);
      if (
        !current ||
        current.attempt.provider !== "afterpay" ||
        current.attempt.method !== "afterpay" ||
        !current.attempt.providerReference ||
        !["created", "requires_action", "processing"].includes(current.attempt.status)
      ) {
        throw unavailableStart();
      }
      const registration = byMethod.get("afterpay");
      if (!registration || registration.provider.key !== "afterpay") {
        throw unavailableStart();
      }

      let authority;
      try {
        authority = await registration.provider.retrieve({
          order: providerPaymentOrder(current.order),
          providerReference: current.attempt.providerReference,
        });
      } catch {
        throw unavailableStart();
      }

      let result: VerifiedPaymentResult;
      if (authority.kind === "verified") {
        result = authority.result;
      } else if (authority.kind === "authoritative_not_found") {
        result = Object.freeze({
          providerReference: current.attempt.providerReference,
          providerStatus: "ABANDONED:NOT_FOUND",
          amountCents: current.attempt.expectedAmountCents,
          currency: current.attempt.currency,
          orderNumber: current.order.orderNumber,
          status: "cancelled" as const,
        });
      } else {
        throw unavailableStart();
      }

      const applied = await repository.applyVerifiedResult({
        attemptId: current.attempt.id,
        result,
        source: "reconciliation",
      });
      return Object.freeze({
        payment: publicPayment(
          applied.attempt.method,
          applied.attempt.status,
          registration.isTest,
        ),
        orderNumber: applied.order.orderNumber,
      });
    },

    async confirmPayment(
      access: PaymentOrderAccess,
    ): Promise<PaymentConfirmationResult> {
      const current = await repository.findCurrentPayment(access);
      if (!current || !current.attempt.providerReference) {
        throw new PaymentServiceError("ORDER_NOT_FOUND", "Order is unavailable");
      }
      const registration = byMethod.get(current.attempt.method);
      if (
        !registration ||
        registration.provider.key !== current.attempt.provider
      ) {
        throw unavailableStart();
      }

      let authority;
      try {
        authority = await registration.provider.retrieve({
          order: providerPaymentOrder(current.order),
          providerReference: current.attempt.providerReference,
        });
      } catch {
        throw unavailableStart();
      }
      if (authority.kind !== "verified") throw unavailableStart();

      const applied = await repository.applyVerifiedResult({
        attemptId: current.attempt.id,
        result: authority.result,
        source: "reconciliation",
      });
      return Object.freeze({
        payment: publicPayment(
          applied.attempt.method,
          applied.attempt.status,
          registration.isTest,
        ),
        orderNumber: applied.order.orderNumber,
      });
    },

    async reconcilePendingPayments(): Promise<PaymentReconciliationSummary> {
      const summary = {
        processed: 0,
        applied: 0,
        retried: 0,
        pending: 0,
        failed: 0,
      };

      for (let index = 0; index < 50; index += 1) {
        const [candidate] = await repository.claimReconciliationCandidates(1);
        if (!candidate) break;
        summary.processed += 1;
        const recordOutcome = async (
          code: Parameters<PaymentRepository["recordReconciliationOutcome"]>[0]["code"],
        ) => {
          try {
            await repository.recordReconciliationOutcome({
              attemptId: candidate.attempt.id,
              claimId: candidate.claimId,
              code,
            });
          } catch {
            // A concurrent verified transition may already own the final state.
          }
        };

        try {
          const registration = byMethod.get(candidate.attempt.method);
          if (
            !registration ||
            registration.provider.key !== candidate.attempt.provider ||
            !candidate.attempt.providerReference
          ) {
            throw new PaymentProviderVerificationError();
          }
          const authority = await registration.provider.retrieve({
            order: candidate.order,
            providerReference: candidate.attempt.providerReference,
          });

          let result: VerifiedPaymentResult;
          if (authority.kind === "verified") {
            result = authority.result;
          } else {
            if (!registration.provider.retryCompletion) {
              await recordOutcome("reconciliation_pending");
              summary.pending += 1;
              continue;
            }
            summary.retried += 1;
            result = await registration.provider.retryCompletion({
              order: candidate.order,
              providerReference: candidate.attempt.providerReference,
              idempotencyKey: candidate.attempt.idempotencyKey,
              attemptCreatedAt: candidate.attempt.createdAt,
              source: "reconciliation",
            });
          }

          if (!matchesReconciliationAuthority(candidate, result)) {
            throw new PaymentProviderVerificationError();
          }
          await repository.applyReconciliationResult({
            attemptId: candidate.attempt.id,
            claimId: candidate.claimId,
            result,
          });
          summary.applied += 1;
          if (result.status === "processing") summary.pending += 1;
        } catch (error) {
          if (error instanceof PaymentProviderRequestError) {
            await recordOutcome("reconciliation_retrieval_unavailable");
            summary.pending += 1;
          } else {
            await recordOutcome("reconciliation_verification_failed");
            summary.failed += 1;
          }
        }
      }

      return Object.freeze(summary);
    },

    async applyVerifiedWebhook(
      event: VerifiedProviderEvent,
      rawBody: Uint8Array,
    ) {
      if (!webhookProviders.has(event.provider)) {
        throw new Error("Payment webhook provider is unavailable");
      }
      const payloadSha256 = createHash("sha256").update(rawBody).digest("hex");
      return repository.applyVerifiedWebhookEventAtomically({
        provider: event.provider,
        providerEventId: event.providerEventId,
        result: event.result,
        payloadSha256,
      });
    },

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
      return methodsForContext(context);
    },

    async availableMethodsForOrder(
      access: PaymentOrderAccess,
    ): Promise<readonly PublicPaymentMethod[]> {
      const order = await repository.findPayableOrder(access);
      if (!order) {
        throw new PaymentServiceError("ORDER_NOT_FOUND", "Order is unavailable");
      }
      return methodsForContext(order);
    },

    async handleReturn(input: PaymentReturnInput): Promise<PaymentReturnResult> {
      const registration = byMethod.get(input.method);
      const expectedPath = `/api/payments/returns/${input.provider}`;
      if (
        !registration ||
        registration.provider.key !== input.provider ||
        input.returnUrl.origin !== trustedOrigin ||
        input.returnUrl.pathname !== expectedPath ||
        !/^[a-f0-9]{64}$/.test(input.returnState)
      ) {
        throw unavailableReturn();
      }

      const consumed = await repository.consumeReturnState({
        provider: input.provider,
        method: input.method,
        digest: digestReturnState(input.returnState),
        orderNumber: input.orderNumber,
        providerReference: input.providerReference,
      });
      if (!consumed) throw unavailableReturn();
      if (consumed.outcome === "already_consumed") {
        return Object.freeze({ orderNumber: consumed.orderNumber });
      }

      const { attempt: storedAttempt, order: storedOrder } = consumed;
      if (
        storedAttempt.provider !== input.provider ||
        storedAttempt.method !== input.method ||
        storedAttempt.providerReference !== input.providerReference ||
        storedAttempt.returnStateDigest !== digestReturnState(input.returnState) ||
        storedAttempt.orderId !== storedOrder.id ||
        storedOrder.orderNumber !== input.orderNumber ||
        storedAttempt.expectedAmountCents !== storedOrder.amountCents ||
        storedAttempt.currency !== storedOrder.currency
      ) {
        throw unavailableReturn();
      }

      if (storedAttempt.status === "cancelled") {
        return Object.freeze({ orderNumber: storedOrder.orderNumber });
      }

      if (
        input.provider === "stripe" ||
        (input.provider === "zip" && storedOrder.currency !== "AUD")
      ) {
        return Object.freeze({ orderNumber: storedOrder.orderNumber });
      }

      let result;
      try {
        result = await registration.provider.completeReturn({
          order: storedOrder,
          providerReference: storedAttempt.providerReference,
          idempotencyKey: storedAttempt.idempotencyKey,
          attemptCreatedAt: storedAttempt.createdAt,
          returnState: input.returnState,
          returnUrl: input.returnUrl,
        });
      } catch (error) {
        if (error instanceof PaymentProviderVerificationError) {
          throw unavailableReturn();
        }
        if (!(error instanceof PaymentProviderRequestError)) throw error;
        await repository.applyVerifiedResult({
          attemptId: storedAttempt.id,
          result: {
            providerReference: storedAttempt.providerReference,
            providerStatus: "RETURN_STATUS_UNKNOWN",
            amountCents: storedAttempt.expectedAmountCents,
            currency: storedAttempt.currency,
            orderNumber: storedOrder.orderNumber,
            status: "processing",
          },
          source: "browser_return",
        });
        return Object.freeze({ orderNumber: storedOrder.orderNumber });
      }

      await repository.applyVerifiedResult({
        attemptId: storedAttempt.id,
        result,
        source: "server_capture",
      });
      return Object.freeze({ orderNumber: storedOrder.orderNumber });
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
      if (order.currency !== "NZD" && order.currency !== "AUD") {
        throw new PaymentServiceError(
          "PAYMENT_UNAVAILABLE",
          "Payment method is unavailable",
        );
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
          eligibilityContext(order satisfies PaymentEligibilityContext),
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
        currency: order.currency,
        clientKey,
      });
      if (claim.outcome === "existing_conflict") {
        throw new PaymentServiceError(
          "PAYMENT_ATTEMPT_IN_PROGRESS",
          "Another payment attempt is in progress",
        );
      }
      const createSession = async (
        stableReturnState?: string,
        providerReference?: string,
      ) => {
        const returnState = stableReturnState ?? deriveReturnState({
          attemptId: claim.attempt.id,
          idempotencyKey: claim.attempt.idempotencyKey,
          provider: registration.provider.key,
          method,
        });
        if (!/^[a-f0-9]{64}$/.test(returnState)) throw new Error("Invalid return state");
        const session = await registration.provider.createOrReuse({
          order,
          attemptId: claim.attempt.id,
          idempotencyKey: claim.attempt.idempotencyKey,
          providerReference,
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
        return { returnState, session };
      };
      if (claim.outcome === "existing" || !claim.claimId) {
        if (!claim.attempt.providerReference) {
          return Object.freeze({
            payment: publicPayment(method, claim.attempt.status, registration.isTest),
            action: null,
          });
        }
        try {
          const expectedState = deriveReturnState({
            attemptId: claim.attempt.id,
            idempotencyKey: claim.attempt.idempotencyKey,
            provider: registration.provider.key,
            method,
          });
          if (
            !/^[a-f0-9]{64}$/.test(expectedState) ||
            claim.attempt.returnStateDigest !== digestReturnState(expectedState)
          ) throw new Error("Payment return state mismatch");
          const { session } = await createSession(
            expectedState,
            claim.attempt.providerReference,
          );
          if (session.providerReference !== claim.attempt.providerReference) {
            throw new Error("Payment provider reference mismatch");
          }
          return Object.freeze({
            payment: publicPayment(method, claim.attempt.status, registration.isTest),
            action: toImmediatePaymentActionDTO(session),
          });
        } catch {
          throw unavailableStart();
        }
      }

      let returnState: string;
      let session: ProviderSession;
      try {
        ({ returnState, session } = await createSession());
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
