import type { NormalizedAddress } from "@/domain/address/types";
import type { OrderAttribution } from "@/domain/analytics/attribution";
import type { RepricedCheckoutCart } from "@/domain/checkout/types";
import type { DeliveryPreference } from "@/domain/configuration/types";
import type { CheckoutSessionRecord, CheckoutStateRecord } from "@/server/checkout/checkout-repository";
import type { ProviderShippingQuote } from "@/server/shipping/types";
import type { MarketCurrency } from "@/domain/markets/types";

export type OrderRecord = Readonly<{
  id: string;
  checkoutSessionId: string;
  idempotencyKey: string;
  orderNumber: string;
  customerId: string | null;
  customerEmail: string;
  currency: MarketCurrency;
  totalInclGstCents: number;
  paymentStatus: "awaiting_payment" | "processing" | "paid" | "failed" | "cancelled" | "refunded";
}>;

export type AtomicOrderShipping =
  | Readonly<{ kind: "pickup" }>
  | Readonly<{
      kind: "post";
      requestDigest: string;
      quote: ProviderShippingQuote;
    }>;

export type AtomicOrderInput = Readonly<{
  sessionId: string;
  expectedCustomerId: string | null;
  expectedVersion: number;
  expectedCartDigest: string;
  cart: RepricedCheckoutCart;
  billingAddress: NormalizedAddress;
  deliveryAddress: NormalizedAddress;
  deliveryMethod: DeliveryPreference;
  shipping: AtomicOrderShipping;
  attribution?: OrderAttribution | null;
  idempotencyKey: string;
  orderNumber: string;
  now: Date;
}>;

export interface OrderRepository {
  findSessionByTokenDigest(
    tokenDigest: string,
    now: Date,
  ): Promise<CheckoutSessionRecord | null>;
  findBySession(sessionId: string): Promise<OrderRecord | null>;
  getCheckoutState(sessionId: string): Promise<CheckoutStateRecord | null>;
  findOwnedUploadIds(sessionId: string, uploadIds: string[]): Promise<string[]>;
  createAtomicOrder(input: AtomicOrderInput): Promise<OrderRecord>;
}

export class OrderConflictError extends Error {
  constructor(message = "This checkout already has an order") {
    super(message);
    this.name = "OrderConflictError";
  }
}

export class AtomicOrderStateError extends Error {
  constructor(message = "The checkout changed before the order was created") {
    super(message);
    this.name = "AtomicOrderStateError";
  }
}

export class UnclaimableUploadError extends Error {
  constructor() {
    super("One or more uploads cannot be claimed by this order");
    this.name = "UnclaimableUploadError";
  }
}

export class OrderNumberCollisionError extends Error {
  constructor() {
    super("Order number collision");
    this.name = "OrderNumberCollisionError";
  }
}
