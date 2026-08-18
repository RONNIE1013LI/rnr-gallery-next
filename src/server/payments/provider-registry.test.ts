import { afterEach, describe, expect, it, vi } from "vitest";
import type { NormalizedAddress } from "@/domain/address/types";
import type { PaymentMethodKey, PaymentProviderKey } from "@/server/db/schema";
import { parsePaymentConfig, type PaymentConfig } from "./config";
import { createLocalTestProvider } from "./local-test-provider";
import type { PaymentRepository } from "./payment-repository";
import { createPaymentService } from "./payment-service";
import { selectPaymentProviders } from "./provider-registry";
import type { PaymentOrder, PaymentProvider } from "./types";

const disabled = Object.freeze({ enabled: false } as const);
const completeProviderEnvironment = {
  stripe: {
    STRIPE_SECRET_KEY: "stripe-secret",
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_public",
    STRIPE_WEBHOOK_SECRET: "whsec_test",
  },
  afterpay: {
    AFTERPAY_MERCHANT_ID: "afterpay-merchant",
    AFTERPAY_SECRET_KEY: "afterpay-secret",
    AFTERPAY_ENVIRONMENT: "sandbox",
    AFTERPAY_MERCHANT_COUNTRY: "NZ",
  },
} as const;

function config(overrides: Partial<PaymentConfig> = {}): PaymentConfig {
  return {
    stripe: disabled,
    afterpay: disabled,
    localTest: { enabled: true, isTest: true },
    operations: { returnBaseUrl: "http://localhost:3000", reconciliationSecret: null },
    ...overrides,
  };
}

function fakeProvider(
  key: PaymentProviderKey,
  method: PaymentMethodKey,
): PaymentProvider {
  return {
    key,
    method,
    refundCapability: "unsupported",
    async availability() { return { available: true }; },
    async createOrReuse() { throw new Error("not used"); },
    async completeReturn() { throw new Error("not used"); },
    async retrieve() { throw new Error("not used"); },
  };
}

function auNzdOrder(): PaymentOrder {
  const address: NormalizedAddress = {
    country: "AU",
    fullName: "AU Customer",
    building: "",
    street: "1 Test Street",
    suburb: "Sydney",
    region: "NSW",
    postcode: "2000",
    phone: "+61400000000",
    email: "customer@example.test",
  };
  return {
    id: "order-id",
    orderNumber: "RNR-1001",
    amountCents: 12_075,
    currency: "NZD",
    customer: { fullName: address.fullName, email: address.email, phone: address.phone },
    billingAddress: address,
    deliveryAddress: address,
  };
}

describe("payment provider registry", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds explicit local methods and exposes exact labels", async () => {
    const providers = selectPaymentProviders(config(), { nodeEnv: "test" });

    expect(providers.map(({ method, label, isTest, provider }) => ({
      method,
      label,
      isTest,
      refundCapability: provider.refundCapability,
    }))).toEqual([
      { method: "card", label: "Test card — no real payment", isTest: true, refundCapability: "unsupported" },
      { method: "afterpay", label: "Test Afterpay — no real payment", isTest: true, refundCapability: "unsupported" },
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
  ] as const)(
    "keeps a partial %s configuration local-test-only when %s is missing",
    async (provider, missing) => {
      const parsed = parsePaymentConfig({
        NODE_ENV: "test",
        ...completeProviderEnvironment[provider],
        [missing]: undefined,
        PAYMENT_RETURN_BASE_URL: "https://shop.example.test",
        ENABLE_LOCAL_TEST_PAYMENTS: "true",
      });
      const cardFactory = vi.fn(() => fakeProvider("stripe", "card"));
      const afterpayFactory = vi.fn(() => fakeProvider("afterpay", "afterpay"));
      const localFactory = vi.fn(createLocalTestProvider);
      const providers = selectPaymentProviders(parsed, {
        nodeEnv: "test",
        realFactories: {
          card: cardFactory,
          afterpay: afterpayFactory,
        },
        localFactory,
      });
      const nzOrder = {
        ...auNzdOrder(),
        customer: {
          fullName: "NZ Customer",
          email: "customer@example.test",
          phone: "+64210000000",
        },
        billingAddress: {
          ...auNzdOrder().billingAddress,
          country: "NZ" as const,
          fullName: "NZ Customer",
          suburb: "Auckland Central",
          region: "Auckland",
          postcode: "1010",
          phone: "+64210000000",
        },
        deliveryAddress: {
          ...auNzdOrder().deliveryAddress,
          country: "NZ" as const,
          fullName: "NZ Customer",
          suburb: "Auckland Central",
          region: "Auckland",
          postcode: "1010",
          phone: "+64210000000",
        },
      };
      const methods = await createPaymentService({
        repository: {} as PaymentRepository,
        providers,
        checkoutAuthority: {
          findReviewedPaymentContext: vi.fn().mockResolvedValue({
            amountCents: nzOrder.amountCents,
            currency: nzOrder.currency,
            customer: nzOrder.customer,
            billingAddress: nzOrder.billingAddress,
            deliveryAddress: nzOrder.deliveryAddress,
          }),
        },
        returnBaseUrl: "https://shop.example.test",
      }).availableMethods({
        sessionId: "checkout-id",
        checkoutVersion: 1,
        cartDigest: "a".repeat(64),
      });

      expect(methods).toEqual([
        { method: "card", label: "Test card — no real payment", isTest: true },
        { method: "afterpay", label: "Test Afterpay — no real payment", isTest: true },
      ]);
      expect(providers.every(({ isTest, provider }) =>
        isTest && provider.key === "local-test")).toBe(true);
      expect(cardFactory).not.toHaveBeenCalled();
      expect(afterpayFactory).not.toHaveBeenCalled();
    },
  );

  it("uses real configured providers by method and constructs nothing unintended", () => {
    const cardFactory = vi.fn(() => fakeProvider("stripe", "card"));
    const afterpayFactory = vi.fn(() => fakeProvider("afterpay", "afterpay"));
    const localFactory = vi.fn(createLocalTestProvider);
    const providers = selectPaymentProviders(config({
      stripe: {
        enabled: true,
        secretKey: "secret",
        publishableKey: "public",
        webhookSecret: "webhook",
        supportedCurrencies: ["NZD"],
      },
      afterpay: {
        enabled: true,
        merchantId: "merchant",
        secretKey: "secret",
        environment: "sandbox",
        merchantCountry: "NZ",
        currency: "NZD",
      },
    }), {
      nodeEnv: "test",
      realFactories: {
        card: cardFactory,
        afterpay: afterpayFactory,
      },
      localFactory,
    });

    expect(providers.map(({ method, isTest }) => ({ method, isTest }))).toEqual([
      { method: "card", isTest: false },
      { method: "afterpay", isTest: false },
    ]);
    expect(cardFactory).toHaveBeenCalledOnce();
    expect(afterpayFactory).toHaveBeenCalledOnce();
    expect(localFactory).not.toHaveBeenCalled();
  });

  it("constructs no local provider when disabled and never falls back over real config", () => {
    const localFactory = vi.fn(createLocalTestProvider);
    const cardFactory = vi.fn(() => fakeProvider("stripe", "card"));
    expect(selectPaymentProviders(config({
      localTest: disabled,
    }), {
      nodeEnv: "test",
      realFactories: { card: cardFactory },
      localFactory,
    })).toEqual([]);
    expect(localFactory).not.toHaveBeenCalled();
    expect(cardFactory).not.toHaveBeenCalled();

    const configuredWithoutFactory = selectPaymentProviders(config({
      stripe: {
        enabled: true,
        secretKey: "secret",
        publishableKey: "public",
        webhookSecret: "webhook",
        supportedCurrencies: ["NZD"],
      },
    }), { nodeEnv: "test", localFactory });
    expect(configuredWithoutFactory.map(({ method, provider }) => ({ method, provider: provider.key }))).toEqual([
      { method: "card", provider: "stripe" },
      { method: "afterpay", provider: "local-test" },
    ]);
    expect(localFactory).toHaveBeenCalledOnce();
  });

  it("constructs the real Afterpay provider from enabled repository config", () => {
    const providers = selectPaymentProviders(config({
      localTest: disabled,
      afterpay: {
        enabled: true,
        merchantId: "merchant",
        secretKey: "secret",
        environment: "sandbox",
        merchantCountry: "NZ",
        currency: "NZD",
      },
    }), { nodeEnv: "test" });

    expect(providers.map(({ method, isTest, provider }) => ({
      method,
      isTest,
      key: provider.key,
    }))).toEqual([
      { method: "afterpay", isTest: false, key: "afterpay" },
    ]);
  });

  it("cannot create local providers through a production registry override", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => selectPaymentProviders(config(), { nodeEnv: "test" }))
      .toThrow("Local test payments cannot run in production");
  });

  it("rejects real factories that return a local, wrong-key, or wrong-method provider", () => {
    const localFactory = vi.fn(createLocalTestProvider);
    const realCardConfig = config({
      stripe: {
        enabled: true,
        secretKey: "secret",
        publishableKey: "public",
        webhookSecret: "webhook",
        supportedCurrencies: ["NZD"],
      },
    });

    expect(() => selectPaymentProviders(realCardConfig, {
      nodeEnv: "test",
      realFactories: { card: () => fakeProvider("local-test", "card") },
      localFactory,
    })).toThrow("Payment provider identity mismatch for card");
    expect(() => selectPaymentProviders(realCardConfig, {
      nodeEnv: "test",
      realFactories: { card: () => fakeProvider("afterpay", "card") },
      localFactory,
    })).toThrow("Payment provider identity mismatch for card");
    expect(() => selectPaymentProviders(realCardConfig, {
      nodeEnv: "test",
      realFactories: { card: () => fakeProvider("stripe", "afterpay") },
      localFactory,
    })).toThrow("Payment provider identity mismatch for card");
    expect(localFactory).not.toHaveBeenCalled();
  });

  it("rejects a local factory that returns a real provider", () => {
    const localFactory = vi.fn(() => fakeProvider("stripe", "card"));
    expect(() => selectPaymentProviders(config(), {
      nodeEnv: "test",
      localFactory,
    })).toThrow("Payment provider identity mismatch for card");
    expect(localFactory).toHaveBeenCalledOnce();
  });
});
