import type { NormalizedAddress } from "@/domain/address/types";
import type {
  PaymentAttemptStatus,
  PaymentMethodKey,
  PaymentProviderKey,
} from "@/server/db/schema/payments";

export type PaymentCurrency = "NZD" | "AUD" | "USD" | "CAD";

export class PaymentProviderRequestError extends Error {}

export class PaymentProviderVerificationError extends Error {}

export type PaymentEligibilityContext = Readonly<{
  amountCents: number;
  currency: PaymentCurrency;
  customer: Readonly<{
    fullName: string;
    email: string;
    phone: string;
  }>;
  billingAddress: NormalizedAddress;
  deliveryAddress: NormalizedAddress;
}>;

export type PaymentOrder = PaymentEligibilityContext & Readonly<{
  id: string;
  orderNumber: string;
}>;

export type ProviderAvailability =
  | Readonly<{ available: true }>
  | Readonly<{ available: false; reason: string }>;

export type CreateProviderSessionInput = Readonly<{
  order: PaymentOrder;
  attemptId: string;
  idempotencyKey: string;
  returnState: string;
  returnUrl: string;
  cancelUrl: string;
}>;

export type CompleteProviderReturnInput = Readonly<{
  order: PaymentOrder;
  providerReference: string;
  idempotencyKey: string;
  attemptCreatedAt: Date;
  returnState: string;
  returnUrl: URL;
}>;

export type RetrieveProviderPaymentInput = Readonly<{
  order: PaymentOrder;
  providerReference: string;
}>;

export type RetryProviderCompletionInput = Readonly<{
  order: PaymentOrder;
  providerReference: string;
  idempotencyKey: string;
  attemptCreatedAt: Date;
  source: "reconciliation";
}>;

type ProviderSessionBase = Readonly<{
  provider: PaymentProviderKey;
  method: PaymentMethodKey;
  providerReference: string;
  providerStatus: string;
}>;

export type ProviderSession =
  | (ProviderSessionBase &
      Readonly<{
        kind: "elements";
        provider: "stripe";
        method: "card";
        clientSecret: string;
        returnUrl: string;
      }>)
  | (ProviderSessionBase &
      Readonly<{
        kind: "redirect";
        redirectUrl: string;
      }>)
  | (ProviderSessionBase &
      Readonly<{
        kind: "test";
        provider: "local-test";
        url: string;
      }>);

export type VerifiedPaymentStatus = Extract<
  PaymentAttemptStatus,
  "processing" | "paid" | "failed" | "cancelled"
>;

export type VerifiedPaymentResult = Readonly<{
  providerReference: string;
  providerStatus: string;
  amountCents: number;
  currency: PaymentCurrency;
  orderNumber: string;
  status: VerifiedPaymentStatus;
  sanitizedFailureCode?: string;
}>;

export type VerifiedProviderEvent = Readonly<{
  provider: PaymentProviderKey;
  providerEventId: string;
  result: VerifiedPaymentResult;
}>;

export interface PaymentProvider {
  readonly key: PaymentProviderKey;
  readonly method: PaymentMethodKey;
  readonly refundCapability: "unsupported" | "full" | "partial";
  availability(context: PaymentEligibilityContext): Promise<ProviderAvailability>;
  createOrReuse(input: CreateProviderSessionInput): Promise<ProviderSession>;
  completeReturn(
    input: CompleteProviderReturnInput,
  ): Promise<VerifiedPaymentResult>;
  retrieve(
    input: RetrieveProviderPaymentInput,
  ): Promise<VerifiedPaymentResult>;
  /** Server-side recovery only, after authoritative retrieval proves incomplete. */
  retryCompletion?(
    input: RetryProviderCompletionInput,
  ): Promise<VerifiedPaymentResult>;
  verifyWebhook?(
    rawBody: Uint8Array,
    headers: Headers,
  ): Promise<VerifiedProviderEvent>;
}
