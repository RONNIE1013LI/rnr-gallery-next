import type { MarketCurrency } from "@/domain/markets/types";
import type {
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
  createdAt: string;
  updatedAt: string;
}>;

export type PaymentRequestCreateResult = Readonly<{
  request: AdminPaymentRequestDTO;
  rawToken: string;
}>;
