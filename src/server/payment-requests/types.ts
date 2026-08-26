import type { MarketCurrency } from "@/domain/markets/types";
import type {
  PaymentLedgerDirection,
  PaymentLedgerEntryType,
  PaymentMethodKey,
  PaymentRequestKind,
  PaymentRequestStatus,
} from "@/server/db/schema/payments";

export type PublicPaymentRequestDTO = Readonly<{
  requestNumber: string;
  kind: PaymentRequestKind;
  orderNumber?: string;
  description: string;
  amountCents: number;
  currency: MarketCurrency;
  status: PaymentRequestStatus;
  methods: readonly PaymentMethodKey[];
  expiresAt?: string;
}>;

export type AdminPaymentRequestDTO = PublicPaymentRequestDTO & Readonly<{
  id: string;
  orderId?: string;
  customerName?: string;
  customerEmail?: string;
  internalNote?: string;
  statusReason?: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
}>;

export type PaymentRequestCreateResult = Readonly<{
  request: AdminPaymentRequestDTO;
  rawToken?: string;
}>;

export type AdminPaymentLedgerEntryDTO = Readonly<{
  id: string;
  entryType: PaymentLedgerEntryType;
  direction: PaymentLedgerDirection;
  amountCents: number;
  currency: MarketCurrency;
  receivedAt: string;
  reference?: string;
  payerName?: string;
  note?: string;
  reversesEntryId?: string;
  createdAt: string;
}>;

export type AdminOrderPaymentSummaryDTO = Readonly<{
  orderId: string;
  orderNumber: string;
  currency: MarketCurrency;
  totalCents: number;
  netPaidCents: number;
  outstandingCents: number;
  reservedCents: number;
  unreservedCents: number;
  ledger: readonly AdminPaymentLedgerEntryDTO[];
}>;
