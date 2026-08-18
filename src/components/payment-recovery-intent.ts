import type { PublicShippingDTO } from "@/server/checkout/public-dto";
import type { PaymentMethodKey } from "@/server/db/schema/payments";
import {
  getActivePaymentIntentStorageKey,
  getPaymentIntentStorageKey,
} from "@/domain/cart/browser-cart-scope";

export const LEGACY_PAYMENT_INTENT_STORAGE_KEY = "rnr-checkout-payment-intent-v1";
export const PAYMENT_INTENT_STORAGE_KEY = getPaymentIntentStorageKey(null);

type ShippingAuthority = Pick<
  PublicShippingDTO["option"],
  "method" | "serviceCode" | "amountExGstCents" | "gstCents" | "amountInclGstCents" | "isTest"
>;

type CheckoutAuthority = Readonly<{
  orderIdempotencyKey: string;
  paymentIdempotencyKey: string;
  method: PaymentMethodKey;
  checkoutVersion: number;
  cartDigest: string;
  shipping: ShippingAuthority;
}>;

export type PlacingOrderIntent = CheckoutAuthority & Readonly<{
  schemaVersion: 1;
  phase: "placing_order";
}>;

export type CheckoutStartingPaymentIntent = CheckoutAuthority & Readonly<{
  schemaVersion: 1;
  phase: "starting_payment";
  orderNumber: string;
}>;

export type DirectStartingPaymentIntent = Readonly<{
  schemaVersion: 1;
  phase: "starting_payment";
  orderNumber: string;
  paymentIdempotencyKey: string;
  method: PaymentMethodKey;
}>;

export type PaymentRecoveryIntent =
  | PlacingOrderIntent
  | CheckoutStartingPaymentIntent
  | DirectStartingPaymentIntent;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORDER_PATTERN = /^RNR-[A-Z0-9]+(?:-[A-Z0-9]+)+$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const SERVICE_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/ -]{0,99}$/;
const CHECKOUT_KEYS = ["schemaVersion", "phase", "orderIdempotencyKey", "paymentIdempotencyKey", "method", "checkoutVersion", "cartDigest", "shipping"];
const DIRECT_STARTING_KEYS = ["schemaVersion", "phase", "orderNumber", "paymentIdempotencyKey", "method"];
const CHECKOUT_STARTING_KEYS = [...CHECKOUT_KEYS, "orderNumber"];
const SHIPPING_KEYS = ["method", "serviceCode", "amountExGstCents", "gstCents", "amountInclGstCents", "isTest"];

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isMethod(value: unknown): value is PaymentMethodKey {
  return value === "card" || value === "afterpay";
}

function validStartingBase(intent: Record<string, unknown>) {
  return intent.schemaVersion === 1 &&
    intent.phase === "starting_payment" &&
    typeof intent.orderNumber === "string" && ORDER_PATTERN.test(intent.orderNumber) &&
    typeof intent.paymentIdempotencyKey === "string" && UUID_PATTERN.test(intent.paymentIdempotencyKey) &&
    isMethod(intent.method);
}

function validShipping(value: unknown): value is ShippingAuthority {
  const shipping = record(value);
  if (!shipping || !hasExactKeys(shipping, SHIPPING_KEYS)) return false;
  if (
    (shipping.method !== "post" && shipping.method !== "pickup") ||
    typeof shipping.serviceCode !== "string" ||
    !SERVICE_CODE_PATTERN.test(shipping.serviceCode) ||
    typeof shipping.isTest !== "boolean"
  ) return false;
  for (const key of ["amountExGstCents", "gstCents", "amountInclGstCents"] as const) {
    if (!Number.isSafeInteger(shipping[key]) || Number(shipping[key]) < 0) return false;
  }
  return Number(shipping.amountExGstCents) + Number(shipping.gstCents) === Number(shipping.amountInclGstCents);
}

function validCheckoutAuthority(intent: Record<string, unknown>) {
  return typeof intent.orderIdempotencyKey === "string" &&
    UUID_PATTERN.test(intent.orderIdempotencyKey) &&
    typeof intent.paymentIdempotencyKey === "string" &&
    UUID_PATTERN.test(intent.paymentIdempotencyKey) &&
    intent.orderIdempotencyKey !== intent.paymentIdempotencyKey &&
    isMethod(intent.method) &&
    Number.isSafeInteger(intent.checkoutVersion) && Number(intent.checkoutVersion) > 0 &&
    typeof intent.cartDigest === "string" && DIGEST_PATTERN.test(intent.cartDigest) &&
    validShipping(intent.shipping);
}

export function parsePaymentRecoveryIntent(raw: string | null): PaymentRecoveryIntent | null {
  if (!raw) return null;
  try {
    const intent = record(JSON.parse(raw));
    if (!intent || intent.schemaVersion !== 1) return null;
    if (intent.phase === "placing_order") {
      if (!hasExactKeys(intent, CHECKOUT_KEYS) || !validCheckoutAuthority(intent)) return null;
      return intent as PlacingOrderIntent;
    }
    if (intent.phase !== "starting_payment" || !validStartingBase(intent)) return null;
    if (hasExactKeys(intent, DIRECT_STARTING_KEYS)) return intent as DirectStartingPaymentIntent;
    if (!hasExactKeys(intent, CHECKOUT_STARTING_KEYS) || !validCheckoutAuthority(intent)) return null;
    return intent as CheckoutStartingPaymentIntent;
  } catch {
    return null;
  }
}

export function readPaymentRecoveryIntent(storage: Pick<Storage, "getItem" | "removeItem">) {
  const storageKey = getActivePaymentIntentStorageKey();
  const raw = storage.getItem(storageKey);
  const intent = parsePaymentRecoveryIntent(raw);
  if (raw && !intent) storage.removeItem(storageKey);
  return intent;
}
