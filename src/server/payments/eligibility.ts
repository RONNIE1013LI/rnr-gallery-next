import type { PaymentMethodKey } from "@/server/db/schema/payments";
import type {
  AfterpayPaymentConfig,
  LocalTestPaymentConfig,
  PaymentConfig,
  StripePaymentConfig,
  ZipPaymentConfig,
} from "./config";
import type { PaymentCurrency, PaymentOrder } from "./types";

export type PaymentIneligibilityReason =
  | "configuration"
  | "country"
  | "currency"
  | "limits"
  | "amount";

export type PaymentEligibilityResult =
  | Readonly<{ available: true }>
  | Readonly<{ available: false; reason: PaymentIneligibilityReason }>;

export type LocalTestEligibilityResult =
  | Readonly<{ available: true; isTest: true }>
  | Readonly<{
      available: false;
      reason: PaymentIneligibilityReason;
      isTest: true;
    }>;

export type AfterpayLimits = Readonly<{
  currency: "NZD" | "AUD";
  minimumAmountCents: number;
  maximumAmountCents: number;
}>;

const ZIP_CHARGE_CURRENCIES = new Set<PaymentCurrency>(["AUD", "USD", "CAD"]);
const LOCAL_CARD_CURRENCIES = new Set<PaymentCurrency>([
  "NZD",
  "AUD",
  "USD",
  "CAD",
]);
const COUNTRY_CURRENCY = { NZ: "NZD", AU: "AUD" } as const;

const available = Object.freeze({ available: true } as const);

function unavailable(reason: PaymentIneligibilityReason): PaymentEligibilityResult {
  return Object.freeze({ available: false, reason });
}

function hasValidAmount(order: PaymentOrder) {
  return Number.isSafeInteger(order.amountCents) && order.amountCents > 0;
}

export function stripeEligibility(
  order: PaymentOrder,
  config: StripePaymentConfig,
): PaymentEligibilityResult {
  if (!hasValidAmount(order)) return unavailable("amount");
  if (!config.enabled) return unavailable("configuration");
  if (!config.supportedCurrencies.includes(order.currency)) {
    return unavailable("currency");
  }
  return available;
}

export function afterpayEligibility(
  order: PaymentOrder,
  config: AfterpayPaymentConfig,
  limits: AfterpayLimits | null,
): PaymentEligibilityResult {
  if (!hasValidAmount(order)) return unavailable("amount");
  if (!config.enabled) return unavailable("configuration");
  if (order.billingAddress.country !== config.merchantCountry) {
    return unavailable("country");
  }
  if (order.currency !== config.currency) return unavailable("currency");
  if (!limits) return unavailable("limits");
  if (limits.currency !== order.currency) return unavailable("currency");
  if (
    !Number.isSafeInteger(limits.minimumAmountCents) ||
    !Number.isSafeInteger(limits.maximumAmountCents) ||
    limits.minimumAmountCents < 0 ||
    limits.maximumAmountCents < limits.minimumAmountCents
  ) {
    return unavailable("limits");
  }
  if (
    order.amountCents < limits.minimumAmountCents ||
    order.amountCents > limits.maximumAmountCents
  ) {
    return unavailable("amount");
  }
  return available;
}

export function zipEligibility(
  order: PaymentOrder,
  config: ZipPaymentConfig,
): PaymentEligibilityResult {
  if (!hasValidAmount(order)) return unavailable("amount");
  if (!config.enabled) return unavailable("configuration");
  if (
    order.billingAddress.country !== "AU" ||
    order.deliveryAddress.country !== "AU" ||
    config.merchantCountry !== "AU"
  ) {
    return unavailable("country");
  }
  if (
    !ZIP_CHARGE_CURRENCIES.has(order.currency) ||
    !config.allowedCurrencies.includes(order.currency)
  ) {
    return unavailable("currency");
  }
  return available;
}

export function localTestEligibility(
  order: PaymentOrder,
  config: LocalTestPaymentConfig,
  method: PaymentMethodKey,
): LocalTestEligibilityResult {
  if (!hasValidAmount(order)) {
    return Object.freeze({
      available: false,
      reason: "amount",
      isTest: true,
    });
  }
  if (!config.enabled) {
    return Object.freeze({
      available: false,
      reason: "configuration",
      isTest: true,
    });
  }

  let result: PaymentEligibilityResult;
  if (method === "card") {
    result = LOCAL_CARD_CURRENCIES.has(order.currency)
      ? available
      : unavailable("currency");
  } else if (method === "afterpay") {
    result =
      order.currency === COUNTRY_CURRENCY[order.billingAddress.country]
        ? available
        : unavailable("currency");
  } else if (
    order.billingAddress.country !== "AU" ||
    order.deliveryAddress.country !== "AU"
  ) {
    result = unavailable("country");
  } else {
    result = ZIP_CHARGE_CURRENCIES.has(order.currency)
      ? available
      : unavailable("currency");
  }

  return Object.freeze({ ...result, isTest: true });
}

export function paymentEligibility(
  order: PaymentOrder,
  config: PaymentConfig,
  limits: Readonly<{ afterpay: AfterpayLimits | null }>,
) {
  const realPaymentsEnabled = config.operations.returnBaseUrl !== null;
  const disabledConfig = Object.freeze({ enabled: false } as const);

  return Object.freeze({
    stripe: stripeEligibility(
      order,
      realPaymentsEnabled ? config.stripe : disabledConfig,
    ),
    afterpay: afterpayEligibility(
      order,
      realPaymentsEnabled ? config.afterpay : disabledConfig,
      limits.afterpay,
    ),
    zip: zipEligibility(order, realPaymentsEnabled ? config.zip : disabledConfig),
    localTest: Object.freeze({
      card: localTestEligibility(order, config.localTest, "card"),
      afterpay: localTestEligibility(order, config.localTest, "afterpay"),
      zip: localTestEligibility(order, config.localTest, "zip"),
    }),
  });
}
