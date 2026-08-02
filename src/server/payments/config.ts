import type { PaymentCurrency } from "./types";

type PaymentEnvironment = Readonly<Record<string, string | undefined>>;
type DisabledPaymentConfig = Readonly<{ enabled: false }>;
type ProviderEnvironment = "sandbox" | "production";

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

export type ZipPaymentConfig =
  | DisabledPaymentConfig
  | Readonly<{
      enabled: true;
      apiKey: string;
      environment: ProviderEnvironment;
      merchantCountry: "NZ" | "AU";
      allowedCurrencies: readonly PaymentCurrency[];
    }>;

export type LocalTestPaymentConfig =
  | DisabledPaymentConfig
  | Readonly<{ enabled: true; isTest: true }>;

export type PaymentConfig = Readonly<{
  stripe: StripePaymentConfig;
  afterpay: AfterpayPaymentConfig;
  zip: ZipPaymentConfig;
  localTest: LocalTestPaymentConfig;
  operations: Readonly<{
    returnBaseUrl: string | null;
    reconciliationSecret: string | null;
  }>;
}>;

const PAYMENT_CURRENCIES = ["NZD", "AUD", "USD", "CAD"] as const;
const PAYMENT_CURRENCY_SET = new Set<string>(PAYMENT_CURRENCIES);
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

function parseReturnBaseUrl(rawValue: string | null) {
  if (!rawValue) return null;

  try {
    const url = new URL(rawValue);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function parseStripeConfig(env: PaymentEnvironment): StripePaymentConfig {
  const secretKey = value(env, "STRIPE_SECRET_KEY");
  const publishableKey = value(env, "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY");
  const webhookSecret = value(env, "STRIPE_WEBHOOK_SECRET");

  if (!secretKey || !publishableKey || !webhookSecret) return disabled();

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

function parseAllowedCurrencies(rawValue: string | null) {
  if (!rawValue) return null;

  const currencies = [...new Set(rawValue.split(",").map((item) => item.trim()))];
  if (
    currencies.length === 0 ||
    currencies.some((currency) => !PAYMENT_CURRENCY_SET.has(currency))
  ) {
    return null;
  }

  return currencies as PaymentCurrency[];
}

function parseZipConfig(env: PaymentEnvironment): ZipPaymentConfig {
  const apiKey = value(env, "ZIP_API_KEY");
  const environment = value(env, "ZIP_ENVIRONMENT");
  const merchantCountry = value(env, "ZIP_MERCHANT_COUNTRY");
  const allowedCurrencies = parseAllowedCurrencies(
    value(env, "ZIP_ALLOWED_CURRENCIES"),
  );

  if (
    !apiKey ||
    !environment ||
    !PROVIDER_ENVIRONMENTS.has(environment) ||
    merchantCountry !== "AU" ||
    !allowedCurrencies
  ) {
    return disabled();
  }

  return Object.freeze({
    enabled: true,
    apiKey,
    environment: environment as ProviderEnvironment,
    merchantCountry,
    allowedCurrencies: Object.freeze(allowedCurrencies),
  });
}

export function parsePaymentConfig(
  env: PaymentEnvironment = process.env,
): PaymentConfig {
  const localTestEnabled = value(env, "ENABLE_LOCAL_TEST_PAYMENTS") === "true";
  if (localTestEnabled && env.NODE_ENV === "production") {
    throw new Error("Local test payments cannot run in production");
  }

  return Object.freeze({
    stripe: parseStripeConfig(env),
    afterpay: parseAfterpayConfig(env),
    zip: parseZipConfig(env),
    localTest: localTestEnabled
      ? Object.freeze({ enabled: true, isTest: true })
      : disabled(),
    operations: Object.freeze({
      returnBaseUrl: parseReturnBaseUrl(value(env, "PAYMENT_RETURN_BASE_URL")),
      reconciliationSecret: value(env, "PAYMENT_RECONCILIATION_SECRET"),
    }),
  });
}
