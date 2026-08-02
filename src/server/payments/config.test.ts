import { describe, expect, it } from "vitest";
import { parsePaymentConfig } from "./config";

const completeProviderEnvironment = {
  STRIPE_SECRET_KEY: "stripe-secret",
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_public",
  STRIPE_WEBHOOK_SECRET: "whsec_test",
  AFTERPAY_MERCHANT_ID: "afterpay-merchant",
  AFTERPAY_SECRET_KEY: "afterpay-secret",
  AFTERPAY_ENVIRONMENT: "sandbox",
  AFTERPAY_MERCHANT_COUNTRY: "NZ",
  ZIP_API_KEY: "zip-secret",
  ZIP_ENVIRONMENT: "sandbox",
  ZIP_MERCHANT_COUNTRY: "AU",
  ZIP_ALLOWED_CURRENCIES: "AUD,NZD",
} as const;

describe("parsePaymentConfig", () => {
  it("disables every provider when configuration is empty", () => {
    expect(parsePaymentConfig({})).toMatchObject({
      stripe: { enabled: false },
      afterpay: { enabled: false },
      zip: { enabled: false },
      localTest: { enabled: false },
    });
  });

  it.each([
    ["stripe", { STRIPE_SECRET_KEY: "stripe-secret" }],
    ["afterpay", { AFTERPAY_MERCHANT_ID: "merchant-id" }],
    ["zip", { ZIP_API_KEY: "zip-api-key" }],
  ] as const)("fails the partial %s group closed", (provider, env) => {
    const config = parsePaymentConfig(env);

    expect(config[provider]).toEqual({ enabled: false });
    expect(JSON.stringify(config[provider])).not.toContain(Object.values(env)[0]);
  });

  it("throws when local test payments are explicitly enabled in production", () => {
    expect(() =>
      parsePaymentConfig({
        NODE_ENV: "production",
        ENABLE_LOCAL_TEST_PAYMENTS: "true",
      }),
    ).toThrow("Local test payments cannot run in production");
  });

  it("enables complete, valid provider groups", () => {
    const config = parsePaymentConfig({
      NODE_ENV: "development",
      ...completeProviderEnvironment,
      ZIP_ALLOWED_CURRENCIES: " AUD, NZD, AUD ",
      PAYMENT_RETURN_BASE_URL: "https://shop.example.test",
      PAYMENT_RECONCILIATION_SECRET: "reconciliation-secret",
      ENABLE_LOCAL_TEST_PAYMENTS: "true",
    });

    expect(config.stripe).toMatchObject({
      enabled: true,
      supportedCurrencies: ["NZD", "AUD", "USD", "CAD"],
    });
    expect(config.afterpay).toMatchObject({
      enabled: true,
      environment: "sandbox",
      merchantCountry: "NZ",
      currency: "NZD",
    });
    expect(config.zip).toMatchObject({
      enabled: true,
      environment: "sandbox",
      merchantCountry: "AU",
      allowedCurrencies: ["AUD", "NZD"],
    });
    expect(config.localTest).toEqual({ enabled: true, isTest: true });
    expect(config.operations).toEqual({
      returnBaseUrl: "https://shop.example.test",
      reconciliationSecret: "reconciliation-secret",
    });
  });

  it.each([
    ["missing", undefined],
    ["invalid", "not-an-absolute-url"],
    ["remote HTTP", "http://shop.example.test"],
    ["non-root path", "https://shop.example.test/payments"],
    ["search", "https://shop.example.test/?next=elsewhere"],
    ["hash", "https://shop.example.test/#payments"],
  ])("disables real providers for a %s non-production return URL", (_, returnUrl) => {
    const config = parsePaymentConfig({
      NODE_ENV: "development",
      ...completeProviderEnvironment,
      PAYMENT_RETURN_BASE_URL: returnUrl,
      ENABLE_LOCAL_TEST_PAYMENTS: "true",
    });

    expect(config).toMatchObject({
      stripe: { enabled: false },
      afterpay: { enabled: false },
      zip: { enabled: false },
      localTest: { enabled: true, isTest: true },
      operations: { returnBaseUrl: null },
    });
  });

  it("disables real providers for an HTTP return URL in production", () => {
    const config = parsePaymentConfig({
      NODE_ENV: "production",
      ...completeProviderEnvironment,
      PAYMENT_RETURN_BASE_URL: "http://localhost:3000",
    });

    expect(config).toMatchObject({
      stripe: { enabled: false },
      afterpay: { enabled: false },
      zip: { enabled: false },
      operations: { returnBaseUrl: null },
    });
  });

  it.each(["localhost", "127.0.0.1", "[::1]"])(
    "allows an HTTP return URL on %s outside production",
    (hostname) => {
      const config = parsePaymentConfig({
        NODE_ENV: "development",
        ...completeProviderEnvironment,
        PAYMENT_RETURN_BASE_URL: `http://${hostname}:3000`,
      });

      expect(config.stripe.enabled).toBe(true);
      expect(config.afterpay.enabled).toBe(true);
      expect(config.zip.enabled).toBe(true);
      expect(config.operations.returnBaseUrl).toContain(hostname);
    },
  );

  it.each([
    [{ AFTERPAY_ENVIRONMENT: "invalid" }, "afterpay"],
    [{ AFTERPAY_MERCHANT_COUNTRY: "US" }, "afterpay"],
    [{ ZIP_ENVIRONMENT: "invalid" }, "zip"],
    [{ ZIP_MERCHANT_COUNTRY: "US" }, "zip"],
    [{ ZIP_ALLOWED_CURRENCIES: "AUD,XYZ" }, "zip"],
  ] as const)("disables a group with invalid enum configuration", (override, provider) => {
    const env = {
      AFTERPAY_MERCHANT_ID: "afterpay-merchant",
      AFTERPAY_SECRET_KEY: "afterpay-secret",
      AFTERPAY_ENVIRONMENT: "sandbox",
      AFTERPAY_MERCHANT_COUNTRY: "NZ",
      ZIP_API_KEY: "zip-secret",
      ZIP_ENVIRONMENT: "sandbox",
      ZIP_MERCHANT_COUNTRY: "AU",
      ZIP_ALLOWED_CURRENCIES: "AUD",
      ...override,
    };

    expect(parsePaymentConfig(env)[provider]).toEqual({ enabled: false });
  });
});
