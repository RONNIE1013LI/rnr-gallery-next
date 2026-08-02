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

export function stripeEligibility(
  order: PaymentOrder,
  config: StripePaymentConfig,
): PaymentEligibilityResult {
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
  if (!config.enabled) return unavailable("configuration");
  if (order.country !== config.merchantCountry) return unavailable("country");
  if (order.currency !== config.currency) return unavailable("currency");
  if (!limits) return unavailable("limits");
  if (limits.currency !== order.currency) return unavailable("currency");
  if (
    !Number.isInteger(limits.minimumAmountCents) ||
    !Number.isInteger(limits.maximumAmountCents) ||
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
  if (!config.enabled) return unavailable("configuration");
  if (order.country !== "AU" || config.merchantCountry !== "AU") {
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
      order.currency === COUNTRY_CURRENCY[order.country]
        ? available
        : unavailable("currency");
  } else if (order.country !== "AU") {
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
  return Object.freeze({
    stripe: stripeEligibility(order, config.stripe),
    afterpay: afterpayEligibility(order, config.afterpay, limits.afterpay),
    zip: zipEligibility(order, config.zip),
    localTest: Object.freeze({
      card: localTestEligibility(order, config.localTest, "card"),
      afterpay: localTestEligibility(order, config.localTest, "afterpay"),
      zip: localTestEligibility(order, config.localTest, "zip"),
    }),
  });
}
