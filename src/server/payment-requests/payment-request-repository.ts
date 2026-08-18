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
    idempotencyKey: string;
  }>;
  claimId: string | null;
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
}
