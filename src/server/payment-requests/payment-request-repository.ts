import type { MarketCurrency } from "@/domain/markets/types";
import type {
  PaymentAttemptStatus,
  PaymentLedgerDirection,
  PaymentLedgerEntryType,
  PaymentMethodKey,
  PaymentPayerSnapshot,
  PaymentProviderKey,
  PaymentRequestKind,
  PaymentRequestStatus,
} from "@/server/db/schema/payments";
import type { PaymentVerificationSource } from "@/server/payments/state-machine";
import type { VerifiedEventInput } from "@/server/payments/payment-repository";
import type { VerifiedPaymentResult } from "@/server/payments/types";

export type PaymentRequestRecord = Readonly<{
  id: string;
  requestNumber: string;
  publicTokenDigest: string;
  kind: PaymentRequestKind;
  orderId: string | null;
  orderNumber: string | null;
  customerName: string | null;
  customerEmail: string | null;
  description: string;
  currency: MarketCurrency;
  amountCents: number;
  enabledPaymentMethods: readonly PaymentMethodKey[];
  status: PaymentRequestStatus;
  statusReason: string | null;
  expiresAt: Date | null;
  internalNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type PaymentLedgerEntryRecord = Readonly<{
  id: string;
  orderId: string | null;
  paymentRequestId: string | null;
  paymentAttemptId: string | null;
  entryType: PaymentLedgerEntryType;
  direction: PaymentLedgerDirection;
  amountCents: number;
  currency: MarketCurrency;
  receivedAt: Date;
  reference: string | null;
  payerName: string | null;
  note: string | null;
  reversesEntryId: string | null;
  createdAt: Date;
}>;

export type CreatePaymentRequestRecordInput = Readonly<{
  requestNumber: string;
  publicTokenDigest: string;
  kind: PaymentRequestKind;
  orderId: string | null;
  customerName: string | null;
  customerEmail: string | null;
  description: string;
  currency: MarketCurrency;
  amountCents: number;
  enabledPaymentMethods: readonly PaymentMethodKey[];
  expiresAt: Date | null;
  internalNote: string | null;
  createdBy: string;
}>;

export type RequestAttemptClaim = Readonly<{
  outcome: "claimed" | "existing";
  request: PaymentRequestRecord;
  attempt: Readonly<{
    id: string;
    provider: PaymentProviderKey;
    method: PaymentMethodKey;
    status: PaymentAttemptStatus;
    providerReference: string | null;
    returnStateDigest: string | null;
    returnStateConsumedAt: Date | null;
    idempotencyKey: string;
    expectedAmountCents: number;
    currency: MarketCurrency;
    payerSnapshot: PaymentPayerSnapshot | null;
    createdAt: Date;
  }>;
  claimId: string | null;
}>;

export type PaymentRequestAttemptResult = Readonly<{
  request: PaymentRequestRecord;
  attempt: RequestAttemptClaim["attempt"];
}>;

export type ConsumedPaymentRequestReturn =
  | Readonly<{
      outcome: "consumed";
      request: PaymentRequestRecord;
      attempt: RequestAttemptClaim["attempt"];
    }>
  | Readonly<{
      outcome: "already_consumed";
      requestNumber: string;
    }>;

export type PaymentRequestReconciliationCandidate = PaymentRequestAttemptResult & Readonly<{
  claimId: string;
}>;

export type OrderPaymentSummary = Readonly<{
  orderId: string;
  orderNumber: string;
  currency: MarketCurrency;
  totalCents: number;
  netPaidCents: number;
  outstandingCents: number;
  reservedCents: number;
  ledger: readonly PaymentLedgerEntryRecord[];
}>;

export interface PaymentRequestRepository {
  createRequest(input: CreatePaymentRequestRecordInput): Promise<PaymentRequestRecord>;
  findPublicByDigest(digest: string): Promise<PaymentRequestRecord | null>;
  rotateToken(input: Readonly<{
    requestId: string;
    publicTokenDigest: string;
    actorId: string;
  }>): Promise<PaymentRequestRecord>;
  cancel(input: Readonly<{
    requestId: string;
    actorId: string;
  }>): Promise<PaymentRequestRecord>;
  getOrderSummary(orderId: string): Promise<OrderPaymentSummary>;
  recordBankTransfer(input: Readonly<{
    orderId: string;
    amountCents: number;
    receivedAt: Date;
    reference: string | null;
    payerName: string | null;
    note: string | null;
    createdBy: string;
  }>): Promise<PaymentLedgerEntryRecord>;
  reverseBankTransfer(input: Readonly<{
    entryId: string;
    reason: string;
    createdBy: string;
  }>): Promise<PaymentLedgerEntryRecord>;
  preflightAndClaimAttempt(input: Readonly<{
    publicTokenDigest: string;
    provider: PaymentProviderKey;
    method: PaymentMethodKey;
    payerSnapshot: PaymentPayerSnapshot | null;
  }>): Promise<RequestAttemptClaim>;
  bindProviderSession(input: Readonly<{
    attemptId: string;
    claimId: string;
    providerReference: string;
    returnStateDigest: string | null;
    status: Extract<PaymentAttemptStatus, "requires_action" | "processing">;
  }>): Promise<RequestAttemptClaim["attempt"]>;
  consumeReturnState(input: Readonly<{
    provider: PaymentProviderKey;
    method: PaymentMethodKey;
    digest: string;
    publicTokenDigest: string;
    merchantReference: string;
    providerReference: string;
  }>): Promise<ConsumedPaymentRequestReturn | null>;
  applyVerifiedResult(input: Readonly<{
    attemptId: string;
    result: VerifiedPaymentResult;
    source: PaymentVerificationSource;
  }>): Promise<PaymentRequestAttemptResult>;
  ownsProviderReference(
    provider: PaymentProviderKey,
    providerReference: string,
  ): Promise<boolean>;
  applyVerifiedWebhookEventAtomically(
    input: VerifiedEventInput,
  ): Promise<"applied" | "duplicate" | "hash_mismatch">;
  claimReconciliationCandidates(
    limit: number,
  ): Promise<readonly PaymentRequestReconciliationCandidate[]>;
  applyReconciliationResult(input: Readonly<{
    attemptId: string;
    claimId: string;
    result: VerifiedPaymentResult;
  }>): Promise<PaymentRequestAttemptResult>;
  recordReconciliationOutcome(input: Readonly<{
    attemptId: string;
    claimId: string;
    code: string;
  }>): Promise<void>;
}
