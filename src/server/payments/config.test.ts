import { describe, expect, it } from "vitest";
import { parsePaymentConfig } from "./config";

const completeProviderEnvironment = {
  STRIPE_SECRET_KEY: "sk_test_not_real",
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
      localTest: { enabled: false },
    });
    expect(Object.keys(parsePaymentConfig({}))).toEqual([
      "stripe",
      "afterpay",
      "localTest",
      "operations",
    ]);
  });

  it.each([
    ["stripe", "STRIPE_SECRET_KEY"],
    ["stripe", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"],
    ["stripe", "STRIPE_WEBHOOK_SECRET"],
    ["afterpay", "AFTERPAY_MERCHANT_ID"],
    ["afterpay", "AFTERPAY_SECRET_KEY"],
    ["afterpay", "AFTERPAY_ENVIRONMENT"],
    ["afterpay", "AFTERPAY_MERCHANT_COUNTRY"],
  ] as const)("fails the partial %s group closed when %s is missing", (provider, missing) => {
    const config = parsePaymentConfig({
      NODE_ENV: "development",
      ...completeProviderEnvironment,
      [missing]: undefined,
      PAYMENT_RETURN_BASE_URL: "https://shop.example.test",
    });

    expect(config[provider]).toEqual({ enabled: false });
    expect(config.operations.returnBaseUrl).toBe("https://shop.example.test");
    expect(JSON.stringify(config[provider])).not.toMatch(/secret|merchant|public/i);
  });

  it.each([
    ["test secret with live publishable", "sk_test_not_real", "pk_live_not_real", "whsec_not_real"],
    ["live secret with test publishable", "sk_live_not_real", "pk_test_not_real", "whsec_not_real"],
    ["malformed server key", "stripe-secret", "pk_test_not_real", "whsec_not_real"],
    ["malformed publishable key", "sk_test_not_real", "stripe-public", "whsec_not_real"],
    ["malformed webhook secret", "sk_test_not_real", "pk_test_not_real", "stripe-webhook"],
  ] as const)("disables Stripe for %s", (_, secretKey, publishableKey, webhookSecret) => {
    const config = parsePaymentConfig({
      NODE_ENV: "production",
      PAYMENT_RETURN_BASE_URL: "https://rrgallery.co.nz",
      STRIPE_SECRET_KEY: secretKey,
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: publishableKey,
      STRIPE_WEBHOOK_SECRET: webhookSecret,
    });

    expect(config.stripe).toEqual({ enabled: false });
  });

  it.each([
    ["standard test", "sk_test_not_real", "pk_test_not_real"],
    ["restricted test", "rk_test_not_real", "pk_test_not_real"],
    ["standard live", "sk_live_not_real", "pk_live_not_real"],
    ["restricted live", "rk_live_not_real", "pk_live_not_real"],
  ] as const)("enables a matching %s Stripe group", (_, secretKey, publishableKey) => {
    const config = parsePaymentConfig({
      NODE_ENV: "production",
      PAYMENT_RETURN_BASE_URL: "https://rrgallery.co.nz",
      STRIPE_SECRET_KEY: secretKey,
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: publishableKey,
      STRIPE_WEBHOOK_SECRET: "whsec_not_real",
    });

    expect(config.stripe.enabled).toBe(true);
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
    expect(Object.keys(config)).toEqual([
      "stripe",
      "afterpay",
      "localTest",
      "operations",
    ]);
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
      expect(config.operations.returnBaseUrl).toContain(hostname);
    },
  );

  it("allows private LAN HTTP returns outside production", () => {
    const config = parsePaymentConfig({
      NODE_ENV: "development",
      ...completeProviderEnvironment,
      PAYMENT_RETURN_BASE_URL: "http://192.168.4.199:3000",
    });

    expect(config.operations.returnBaseUrl).toBe(
      "http://192.168.4.199:3000",
    );
  });

  it.each([
    [{ AFTERPAY_ENVIRONMENT: "invalid" }, "afterpay"],
    [{ AFTERPAY_MERCHANT_COUNTRY: "US" }, "afterpay"],
  ] as const)("disables a group with invalid enum configuration", (override, provider) => {
    const env = {
      AFTERPAY_MERCHANT_ID: "afterpay-merchant",
      AFTERPAY_SECRET_KEY: "afterpay-secret",
      AFTERPAY_ENVIRONMENT: "sandbox",
      AFTERPAY_MERCHANT_COUNTRY: "NZ",
      ...override,
    };

    expect(parsePaymentConfig(env)[provider]).toEqual({ enabled: false });
  });
});
