import { afterEach, describe, expect, it, vi } from "vitest";
import type { NormalizedAddress } from "@/domain/address/types";
import type { PaymentMethodKey, PaymentProviderKey } from "@/server/db/schema";
import type { PaymentConfig } from "./config";
import { createLocalTestProvider } from "./local-test-provider";
import { selectPaymentProviders } from "./provider-registry";
import type { PaymentOrder, PaymentProvider } from "./types";

const disabled = Object.freeze({ enabled: false } as const);

function config(overrides: Partial<PaymentConfig> = {}): PaymentConfig {
  return {
    stripe: disabled,
    afterpay: disabled,
    zip: disabled,
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
      { method: "zip", label: "Test Zip — no real payment", isTest: true, refundCapability: "unsupported" },
    ]);
    const zip = providers.find(({ method }) => method === "zip");
    await expect(zip?.provider.availability(auNzdOrder())).resolves.toEqual({
      available: false,
      reason: "currency",
    });
  });

  it("uses real configured providers by method and constructs nothing unintended", () => {
    const cardFactory = vi.fn(() => fakeProvider("stripe", "card"));
    const afterpayFactory = vi.fn(() => fakeProvider("afterpay", "afterpay"));
    const zipFactory = vi.fn(() => fakeProvider("zip", "zip"));
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
        zip: zipFactory,
      },
      localFactory,
    });

    expect(providers.map(({ method, isTest }) => ({ method, isTest }))).toEqual([
      { method: "card", isTest: false },
      { method: "afterpay", isTest: false },
      { method: "zip", isTest: true },
    ]);
    expect(cardFactory).toHaveBeenCalledOnce();
    expect(afterpayFactory).toHaveBeenCalledOnce();
    expect(zipFactory).not.toHaveBeenCalled();
    expect(localFactory).toHaveBeenCalledOnce();
    expect(localFactory).toHaveBeenCalledWith({ nodeEnv: "test", method: "zip" });
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
      { method: "zip", provider: "local-test" },
    ]);
    expect(localFactory).toHaveBeenCalledTimes(2);
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
      realFactories: { card: () => fakeProvider("stripe", "zip") },
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
