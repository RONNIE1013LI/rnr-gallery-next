import { createCheckoutSessionToken, hashCheckoutSessionToken } from "./session-cookie";
import type { NormalizedAddress } from "@/domain/address/types";
import type { RepricedCheckoutCart } from "@/domain/checkout/types";
import type { DeliveryPreference } from "@/domain/configuration/types";
import type { ProviderShippingQuote } from "@/server/shipping/types";
import type { PaymentEligibilityContext } from "@/server/payments/types";

const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000;

export type CheckoutSessionRecord = Readonly<{
  id: string;
  tokenDigest: string;
  customerId: string | null;
  expiresAt: Date;
}>;

export type CheckoutUploadInput = Readonly<{
  id: string;
  checkoutSessionId: string;
  storageKey: string;
  originalName: string;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
}>;

export type CheckoutUploadRecord = CheckoutUploadInput &
  Readonly<{ createdAt: Date }>;

export interface CheckoutRepository {
  findActiveSessionByTokenDigest(
    tokenDigest: string,
    now: Date,
  ): Promise<CheckoutSessionRecord | null>;
  createSession(input: {
    tokenDigest: string;
    customerId: string | null;
    expiresAt: Date;
  }): Promise<CheckoutSessionRecord>;
  deleteEmptySession(sessionId: string): Promise<boolean>;
  createUpload(input: CheckoutUploadInput): Promise<CheckoutUploadRecord>;
  findOwnedUploadIds(sessionId: string, uploadIds: string[]): Promise<string[]>;
}

export type CheckoutStateInput = Readonly<{
  cartDigest: string;
  cartSnapshot: RepricedCheckoutCart;
  billingAddress: NormalizedAddress;
  deliveryAddress: NormalizedAddress;
  deliveryMethod: DeliveryPreference;
}>;

export type CheckoutStateRecord = CheckoutSessionRecord &
  Readonly<{
    version: number;
    cartDigest: string | null;
    cartSnapshot: RepricedCheckoutCart | null;
    billingAddress: NormalizedAddress | null;
    deliveryAddress: NormalizedAddress | null;
    deliveryMethod: DeliveryPreference | null;
    selectedShippingQuoteId: string | null;
    completedAt: Date | null;
  }>;

export type ShippingQuoteRecord = ProviderShippingQuote &
  Readonly<{
    id: string;
    checkoutSessionId: string;
    requestDigest: string;
    createdAt: Date;
  }>;

export interface CheckoutStateRepository extends CheckoutRepository {
  saveCheckoutState(
    sessionId: string,
    input: CheckoutStateInput,
  ): Promise<CheckoutStateRecord | null>;
  getCheckoutState(sessionId: string): Promise<CheckoutStateRecord | null>;
  clearSelectedShippingQuote(
    sessionId: string,
    expectedVersion: number,
  ): Promise<boolean>;
  persistAndSelectShippingQuote(input: {
    sessionId: string;
    expectedVersion: number;
    requestDigest: string;
    quote: ProviderShippingQuote;
  }): Promise<ShippingQuoteRecord | null>;
}

export interface ReviewedPaymentCheckoutRepository {
  findReviewedPaymentContext(input: {
    sessionId: string;
    checkoutVersion: number;
    cartDigest: string;
  }): Promise<PaymentEligibilityContext | null>;
}

export class UnownedUploadReferenceError extends Error {
  constructor() {
    super("One or more uploads do not belong to this checkout session");
    this.name = "UnownedUploadReferenceError";
  }
}

export async function ensureCheckoutSession({
  repository,
  rawToken,
  customerId,
  now = new Date(),
  createToken = createCheckoutSessionToken,
}: {
  repository: CheckoutRepository;
  rawToken: string | null;
  customerId: string | null;
  now?: Date;
  createToken?: () => string;
}): Promise<{
  session: CheckoutSessionRecord;
  cookieToken: string | null;
  created: boolean;
}> {
  const existing = rawToken
    ? await repository.findActiveSessionByTokenDigest(
        hashCheckoutSessionToken(rawToken),
        now,
      )
    : null;

  if (existing && existing.customerId === customerId) {
    return { session: existing, cookieToken: null, created: false };
  }

  const token = createToken();
  const session = await repository.createSession({
    tokenDigest: hashCheckoutSessionToken(token),
    customerId,
    expiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS),
  });
  return { session, cookieToken: token, created: true };
}

export async function assertOwnedUploadReferences(
  repository: CheckoutRepository,
  sessionId: string,
  uploadIds: string[],
): Promise<void> {
  if (uploadIds.length === 0) return;
  const uniqueIds = [...new Set(uploadIds)];
  const ownedIds = await repository.findOwnedUploadIds(sessionId, uniqueIds);
  if (ownedIds.length !== uniqueIds.length) {
    throw new UnownedUploadReferenceError();
  }
}
