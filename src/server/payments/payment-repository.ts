import type { SupportedCountry } from "@/domain/address/types";
import type {
  OrderPaymentStatus,
  PaymentAttemptStatus,
  PaymentMethodKey,
  PaymentProviderKey,
} from "@/server/db/schema";
import type { PaymentVerificationSource } from "./state-machine";
import type { PaymentCurrency, PaymentOrder, VerifiedPaymentResult } from "./types";

export type PaymentOrderAccess =
  | Readonly<{ kind: "guest"; orderNumber: string; tokenDigest: string }>
  | Readonly<{ kind: "customer"; orderNumber: string; customerId: string }>;

export type PaymentAttemptRecord = Readonly<{
  id: string;
  orderId: string;
  provider: PaymentProviderKey;
  method: PaymentMethodKey;
  idempotencyKey: string;
  providerReference: string | null;
  returnStateDigest: string | null;
  returnStateConsumedAt: Date | null;
  expectedAmountCents: number;
  currency: PaymentCurrency;
  country: SupportedCountry;
  status: PaymentAttemptStatus;
  sanitizedFailureCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type CreatePaymentAttemptInput = Readonly<{
  orderId: string;
  provider: PaymentProviderKey;
  method: PaymentMethodKey;
  expectedAmountCents: number;
  currency: "NZD";
  /** Compatibility-only browser value. It is never used for provider idempotency. */
  clientKey?: string;
}>;

export type AttemptClaim = Readonly<{
  outcome: "claimed" | "existing" | "existing_conflict";
  attempt: PaymentAttemptRecord;
  claimId: string | null;
}>;

export type BindProviderSessionInput = Readonly<{
  attemptId: string;
  claimId: string;
  providerReference: string;
  returnStateDigest: string | null;
  status: Extract<PaymentAttemptStatus, "requires_action" | "processing">;
}>;

export type ConsumeReturnStateInput = Readonly<{
  provider: PaymentProviderKey;
  method: PaymentMethodKey;
  digest: string;
  orderNumber: string;
  providerReference: string;
}>;

export type ConsumedReturnState =
  | Readonly<{
      outcome: "consumed";
      attempt: PaymentAttemptRecord;
      order: PaymentOrder;
    }>
  | Readonly<{
      outcome: "already_consumed";
      orderNumber: string;
    }>;

export type PaymentAttemptWithOrder = Readonly<{
  attempt: PaymentAttemptRecord;
  order: PaymentOrder & Readonly<{ paymentStatus: OrderPaymentStatus }>;
}>;

export type ApplyVerifiedResultInput = Readonly<{
  attemptId: string;
  result: VerifiedPaymentResult;
  source: Exclude<PaymentVerificationSource, "verified_webhook">;
}>;

export type VerifiedEventInput = Readonly<{
  result: VerifiedPaymentResult;
  provider: PaymentProviderKey;
  providerEventId: string;
  payloadSha256: string;
  faultAt?: "after_event_insert" | "after_transition" | "before_processed_result";
}>;

export interface PaymentRepository {
  findPayableOrder(access: PaymentOrderAccess): Promise<PaymentOrder | null>;
  createOrClaimNonterminalAttempt(
    input: CreatePaymentAttemptInput,
  ): Promise<AttemptClaim>;
  bindProviderSession(input: BindProviderSessionInput): Promise<PaymentAttemptRecord>;
  consumeReturnState(
    input: ConsumeReturnStateInput,
  ): Promise<ConsumedReturnState | null>;
  applyVerifiedWebhookEventAtomically(
    input: VerifiedEventInput,
  ): Promise<"applied" | "duplicate" | "hash_mismatch">;
  applyVerifiedResult(
    input: ApplyVerifiedResultInput,
  ): Promise<PaymentAttemptWithOrder>;
  listReconciliationCandidates(
    limit: number,
  ): Promise<readonly PaymentAttemptWithOrder[]>;
}

export type ProviderIdempotencyKeyInput = Readonly<{
  attemptId: string;
  provider: PaymentProviderKey;
  operation: string;
}>;

export function isPaymentCurrency(value: unknown): value is PaymentCurrency {
  return value === "NZD" || value === "AUD" || value === "USD" || value === "CAD";
}
