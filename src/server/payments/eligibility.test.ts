import { describe, expect, it } from "vitest";
import type { NormalizedAddress } from "@/domain/address/types";
import type { PaymentOrder } from "./types";
import {
  afterpayEligibility,
  localTestEligibility,
  paymentEligibility,
  stripeEligibility,
  zipEligibility,
} from "./eligibility";
import type {
  AfterpayPaymentConfig,
  LocalTestPaymentConfig,
  PaymentConfig,
  StripePaymentConfig,
  ZipPaymentConfig,
} from "./config";

function orderFor(
  country: "NZ" | "AU",
  currency: PaymentOrder["currency"],
  amountCents = 12_075,
): PaymentOrder {
  const address: NormalizedAddress = {
    country,
    fullName: "Test Customer",
    building: "",
    street: "1 Test Street",
    suburb: "Test Suburb",
    region: country === "NZ" ? "Auckland" : "NSW",
    postcode: country === "NZ" ? "1010" : "2000",
    phone: country === "NZ" ? "+64210000000" : "+61400000000",
    email: "customer@example.test",
  };

  return {
    id: "order-id",
    orderNumber: "RNR-1001",
    amountCents,
    currency,
    country,
    customer: {
      fullName: address.fullName,
      email: address.email,
      phone: address.phone,
    },
    billingAddress: address,
    deliveryAddress: address,
  };
}

const stripeConfig: StripePaymentConfig = {
  enabled: true,
  secretKey: "stripe-secret",
  publishableKey: "pk_test_public",
  webhookSecret: "whsec_test",
  supportedCurrencies: ["NZD", "AUD", "USD", "CAD"],
};

const afterpayConfig: AfterpayPaymentConfig = {
  enabled: true,
  merchantId: "afterpay-merchant",
  secretKey: "afterpay-secret",
  environment: "sandbox",
  merchantCountry: "NZ",
  currency: "NZD",
};

const zipConfig: ZipPaymentConfig = {
  enabled: true,
  apiKey: "zip-secret",
  environment: "sandbox",
  merchantCountry: "AU",
  allowedCurrencies: ["AUD", "NZD"],
};

const localTestConfig: LocalTestPaymentConfig = {
  enabled: true,
  isTest: true,
};

describe("Stripe eligibility", () => {
  it("requires complete configuration and an explicitly supported currency", () => {
    expect(stripeEligibility(orderFor("NZ", "NZD"), stripeConfig)).toEqual({
      available: true,
    });
    expect(
      stripeEligibility(orderFor("AU", "AUD"), {
        ...stripeConfig,
        supportedCurrencies: ["NZD"],
      }),
    ).toEqual({ available: false, reason: "currency" });
    expect(stripeEligibility(orderFor("NZ", "NZD"), { enabled: false })).toEqual({
      available: false,
      reason: "configuration",
    });
  });
});

describe("Afterpay eligibility", () => {
  const limits = {
    currency: "NZD" as const,
    minimumAmountCents: 100,
    maximumAmountCents: 200_000,
  };

  it("requires matching merchant country, currency and fetched limits", () => {
    expect(afterpayEligibility(orderFor("NZ", "NZD"), afterpayConfig, limits)).toEqual({
      available: true,
    });
    expect(afterpayEligibility(orderFor("AU", "AUD"), afterpayConfig, limits)).toEqual({
      available: false,
      reason: "country",
    });
    expect(afterpayEligibility(orderFor("NZ", "AUD"), afterpayConfig, limits)).toEqual({
      available: false,
      reason: "currency",
    });
    expect(afterpayEligibility(orderFor("NZ", "NZD"), afterpayConfig, null)).toEqual({
      available: false,
      reason: "limits",
    });
  });

  it.each([99, 200_001])("rejects an amount outside fetched limits", (amountCents) => {
    expect(
      afterpayEligibility(orderFor("NZ", "NZD", amountCents), afterpayConfig, limits),
    ).toEqual({ available: false, reason: "amount" });
  });

  it.each([
    { ...limits, minimumAmountCents: Number.NaN },
    { ...limits, minimumAmountCents: -1 },
    { ...limits, minimumAmountCents: 500, maximumAmountCents: 499 },
  ])("fails closed for malformed fetched limits", (malformedLimits) => {
    expect(
      afterpayEligibility(orderFor("NZ", "NZD"), afterpayConfig, malformedLimits),
    ).toEqual({ available: false, reason: "limits" });
  });
});

describe("Zip eligibility", () => {
  it("never offers Zip for New Zealand", () => {
    expect(zipEligibility(orderFor("NZ", "AUD"), zipConfig)).toEqual({
      available: false,
      reason: "country",
    });
  });

  it("rejects persisted NZD even when the merchant allowlist contains NZD", () => {
    expect(zipEligibility(orderFor("AU", "NZD"), zipConfig)).toEqual({
      available: false,
      reason: "currency",
    });
  });

  it("requires AU merchant configuration and both currency allowlists", () => {
    expect(zipEligibility(orderFor("AU", "AUD"), zipConfig)).toEqual({
      available: true,
    });
    expect(
      zipEligibility(orderFor("AU", "AUD"), {
        ...zipConfig,
        merchantCountry: "NZ",
      }),
    ).toEqual({ available: false, reason: "country" });
    expect(
      zipEligibility(orderFor("AU", "AUD"), {
        ...zipConfig,
        allowedCurrencies: ["USD"],
      }),
    ).toEqual({ available: false, reason: "currency" });
  });
});

describe("local test eligibility", () => {
  it("is visibly test-only and mirrors method country/currency rules", () => {
    expect(localTestEligibility(orderFor("NZ", "NZD"), localTestConfig, "card")).toEqual({
      available: true,
      isTest: true,
    });
    expect(localTestEligibility(orderFor("NZ", "AUD"), localTestConfig, "zip")).toEqual({
      available: false,
      reason: "country",
      isTest: true,
    });
    expect(localTestEligibility(orderFor("AU", "NZD"), localTestConfig, "zip")).toEqual({
      available: false,
      reason: "currency",
      isTest: true,
    });
  });
});

describe("paymentEligibility", () => {
  it("returns provider decisions without invoking any provider", () => {
    const config: PaymentConfig = {
      stripe: stripeConfig,
      afterpay: afterpayConfig,
      zip: zipConfig,
      localTest: localTestConfig,
      operations: { returnBaseUrl: null, reconciliationSecret: null },
    };

    expect(
      paymentEligibility(orderFor("AU", "NZD"), config, { afterpay: null }),
    ).toMatchObject({
      stripe: { available: true },
      afterpay: { available: false, reason: "country" },
      zip: { available: false, reason: "currency" },
      localTest: {
        card: { available: true, isTest: true },
        afterpay: { available: false, reason: "currency", isTest: true },
        zip: { available: false, reason: "currency", isTest: true },
      },
    });
  });
});
