import { isLocalOrPrivateHostname } from "@/server/network/private-hostname";

import type { PaymentCurrency } from "./types";

type PaymentEnvironment = Readonly<Record<string, string | undefined>>;
type DisabledPaymentConfig = Readonly<{ enabled: false }>;
type ProviderEnvironment = "sandbox" | "production";
type StripeMode = "test" | "live";

export type StripePaymentConfig =
  | DisabledPaymentConfig
  | Readonly<{
      enabled: true;
      secretKey: string;
      publishableKey: string;
      webhookSecret: string;
      supportedCurrencies: readonly PaymentCurrency[];
    }>;

export type AfterpayPaymentConfig =
  | DisabledPaymentConfig
  | Readonly<{
      enabled: true;
      merchantId: string;
      secretKey: string;
      environment: ProviderEnvironment;
      merchantCountry: "NZ" | "AU";
      currency: "NZD" | "AUD";
    }>;

export type LocalTestPaymentConfig =
  | DisabledPaymentConfig
  | Readonly<{ enabled: true; isTest: true }>;

export type PaymentConfig = Readonly<{
  stripe: StripePaymentConfig;
  afterpay: AfterpayPaymentConfig;
  localTest: LocalTestPaymentConfig;
  operations: Readonly<{
    returnBaseUrl: string | null;
    reconciliationSecret: string | null;
  }>;
}>;

const PAYMENT_CURRENCIES = ["NZD", "AUD", "USD", "CAD"] as const;
const PROVIDER_ENVIRONMENTS = new Set<string>(["sandbox", "production"]);
const AFTERPAY_CURRENCY_BY_COUNTRY = {
  NZ: "NZD",
  AU: "AUD",
} as const;

function value(env: PaymentEnvironment, key: string) {
  return env[key]?.trim() || null;
}

function disabled(): DisabledPaymentConfig {
  return Object.freeze({ enabled: false });
}

function stripeServerKeyMode(key: string): StripeMode | null {
  if (key.startsWith("sk_test_") || key.startsWith("rk_test_")) return "test";
  if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) return "live";
  return null;
}

function stripePublishableKeyMode(key: string): StripeMode | null {
  if (key.startsWith("pk_test_")) return "test";
  if (key.startsWith("pk_live_")) return "live";
  return null;
}

export function parsePaymentReturnOrigin(
  rawValue: string | null,
  nodeEnvironment: string | undefined,
) {
  if (!rawValue) return null;

  try {
    const url = new URL(rawValue);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    ) {
      return null;
    }
    if (
      url.protocol === "http:" &&
      (nodeEnvironment === "production" ||
        !isLocalOrPrivateHostname(url.hostname))
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function parseStripeConfig(env: PaymentEnvironment): StripePaymentConfig {
  const secretKey = value(env, "STRIPE_SECRET_KEY");
  const publishableKey = value(env, "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY");
  const webhookSecret = value(env, "STRIPE_WEBHOOK_SECRET");
  const serverMode = secretKey ? stripeServerKeyMode(secretKey) : null;
  const publishableMode = publishableKey
    ? stripePublishableKeyMode(publishableKey)
    : null;

  if (
    !secretKey ||
    !publishableKey ||
    !webhookSecret?.startsWith("whsec_") ||
    !serverMode ||
    serverMode !== publishableMode
  ) return disabled();

  return Object.freeze({
    enabled: true,
    secretKey,
    publishableKey,
    webhookSecret,
    supportedCurrencies: PAYMENT_CURRENCIES,
  });
}

function parseAfterpayConfig(env: PaymentEnvironment): AfterpayPaymentConfig {
  const merchantId = value(env, "AFTERPAY_MERCHANT_ID");
  const secretKey = value(env, "AFTERPAY_SECRET_KEY");
  const environment = value(env, "AFTERPAY_ENVIRONMENT");
  const merchantCountry = value(env, "AFTERPAY_MERCHANT_COUNTRY");

  if (
    !merchantId ||
    !secretKey ||
    !environment ||
    !PROVIDER_ENVIRONMENTS.has(environment) ||
    (merchantCountry !== "NZ" && merchantCountry !== "AU")
  ) {
    return disabled();
  }

  return Object.freeze({
    enabled: true,
    merchantId,
    secretKey,
    environment: environment as ProviderEnvironment,
    merchantCountry,
    currency: AFTERPAY_CURRENCY_BY_COUNTRY[merchantCountry],
  });
}

export function parsePaymentConfig(
  env: PaymentEnvironment = process.env,
): PaymentConfig {
  const returnBaseUrl = parsePaymentReturnOrigin(
    value(env, "PAYMENT_RETURN_BASE_URL"),
    env.NODE_ENV,
  );
  const localTestEnabled = value(env, "ENABLE_LOCAL_TEST_PAYMENTS") === "true";
  if (localTestEnabled && env.NODE_ENV === "production") {
    throw new Error("Local test payments cannot run in production");
  }

  const realProviderEnvironment = returnBaseUrl ? env : {};

  return Object.freeze({
    stripe: parseStripeConfig(realProviderEnvironment),
    afterpay: parseAfterpayConfig(realProviderEnvironment),
    localTest: localTestEnabled
      ? Object.freeze({ enabled: true, isTest: true })
      : disabled(),
    operations: Object.freeze({
      returnBaseUrl,
      reconciliationSecret: value(env, "PAYMENT_RECONCILIATION_SECRET"),
    }),
  });
}
