import type { PaymentMethodKey } from "@/server/db/schema/payments";
import type {
  AfterpayPaymentConfig,
  LocalTestPaymentConfig,
  PaymentConfig,
  StripePaymentConfig,
} from "./config";
import type { PaymentCurrency, PaymentEligibilityContext } from "./types";

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
  consumerCountries: readonly ("NZ" | "AU")[];
}>;

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

function hasValidAmount(order: PaymentEligibilityContext) {
  return Number.isSafeInteger(order.amountCents) && order.amountCents > 0;
}

export function stripeEligibility(
  order: PaymentEligibilityContext,
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
  order: PaymentEligibilityContext,
  config: AfterpayPaymentConfig,
  limits: AfterpayLimits | null,
): PaymentEligibilityResult {
  if (!hasValidAmount(order)) return unavailable("amount");
  if (!config.enabled) return unavailable("configuration");
  if (!order.billingAddress || !order.deliveryAddress) {
    return unavailable("country");
  }
  if (!limits) return unavailable("limits");
  if (
    limits.consumerCountries.length === 0 ||
    limits.consumerCountries.some((country) => country !== "NZ" && country !== "AU")
  ) {
    return unavailable("limits");
  }
  if (!limits.consumerCountries.includes(order.billingAddress.country)) {
    return unavailable("country");
  }
  if (limits.currency !== order.currency) return unavailable("currency");
  if (COUNTRY_CURRENCY[order.billingAddress.country] !== order.currency) {
    return unavailable("currency");
  }
  if (
    order.billingAddress.country === config.merchantCountry &&
    order.currency !== config.currency
  ) {
    return unavailable("currency");
  }
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

export function localTestEligibility(
  order: PaymentEligibilityContext,
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
      order.billingAddress &&
      order.currency === COUNTRY_CURRENCY[order.billingAddress.country]
        ? available
        : unavailable(order.billingAddress ? "currency" : "country");
  } else {
    result = unavailable("configuration");
  }

  return Object.freeze({ ...result, isTest: true });
}

export function paymentEligibility(
  order: PaymentEligibilityContext,
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
    localTest: Object.freeze({
      card: localTestEligibility(order, config.localTest, "card"),
      afterpay: localTestEligibility(order, config.localTest, "afterpay"),
    }),
  });
}
