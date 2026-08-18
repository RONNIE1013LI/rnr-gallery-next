import { afterEach, describe, expect, it, vi } from "vitest";
import type { NormalizedAddress } from "@/domain/address/types";
import type { PaymentMethodKey } from "@/server/db/schema";
import { toImmediatePaymentActionDTO } from "./public-dto";
import { createLocalTestProvider } from "./local-test-provider";
import type { CreateProviderSessionInput, PaymentOrder } from "./types";

function address(country: "NZ" | "AU"): NormalizedAddress {
  return {
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
}

function order(
  country: "NZ" | "AU" = "NZ",
  currency: PaymentOrder["currency"] = "NZD",
  deliveryCountry = country,
): PaymentOrder {
  const billingAddress = address(country);
  return Object.freeze({
    id: "00000000-0000-4000-8000-000000000010",
    orderNumber: "RNR-TEST-1001",
    amountCents: 12_075,
    currency,
    customer: {
      fullName: billingAddress.fullName,
      email: billingAddress.email,
      phone: billingAddress.phone,
    },
    billingAddress,
    deliveryAddress: address(deliveryCountry),
  });
}

function sessionInput(paymentOrder = order()): CreateProviderSessionInput {
  return Object.freeze({
    order: paymentOrder,
    attemptId: "00000000-0000-4000-8000-000000000020",
    idempotencyKey: "a".repeat(64),
    returnState: "a".repeat(64),
    returnUrl: "http://localhost:3000/payments/return",
    cancelUrl: "http://localhost:3000/payments/cancel",
  });
}

describe("local test payment provider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(["card", "afterpay"] as const)(
    "rejects direct %s construction in production",
    (method) => {
      expect(() => createLocalTestProvider({ nodeEnv: "production", method }))
        .toThrow("Local test payments cannot run in production");
    },
  );

  it("uses the process environment when nodeEnv is omitted", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => createLocalTestProvider({ method: "card" }))
      .toThrow("Local test payments cannot run in production");
  });

  it.each(["test", ""])(
    "cannot override a production process with nodeEnv=%j",
    (nodeEnv) => {
      vi.stubEnv("NODE_ENV", "production");
      expect(() => createLocalTestProvider({ method: "card", nodeEnv }))
        .toThrow("Local test payments cannot run in production");
    },
  );

  it.each(["card", "afterpay"] as const)(
    "is visibly local-test and never advertises refunds for %s",
    (method) => {
      const provider = createLocalTestProvider({ nodeEnv: "test", method });
      expect(provider).toMatchObject({
        key: "local-test",
        method,
        refundCapability: "unsupported",
      });
    },
  );

  it("creates a stable session and can complete after provider restart", async () => {
    const input = sessionInput();
    const beforeRestart = createLocalTestProvider({ nodeEnv: "test", method: "card" });
    const first = await beforeRestart.createOrReuse(input);
    const second = await beforeRestart.createOrReuse(input);
    const afterRestart = createLocalTestProvider({ nodeEnv: "test", method: "card" });
    const third = await afterRestart.createOrReuse(input);

    expect(first).toEqual(second);
    expect(first).toEqual(third);
    expect(first).toMatchObject({
      kind: "test",
      provider: "local-test",
      method: "card",
      providerStatus: "TEST_REQUIRES_ACTION",
    });
    if (first.kind !== "test") throw new Error("Expected local test session");
    const callback = new URL(first.url);
    const returnState = callback.searchParams.get("state");
    expect(returnState).toBe(input.returnState);
    callback.searchParams.set("result", "failed");

    await expect(afterRestart.completeReturn({
      order: input.order,
      providerReference: first.providerReference,
      idempotencyKey: input.idempotencyKey,
      attemptCreatedAt: new Date(),
      returnState: returnState!,
      returnUrl: callback,
    })).resolves.toEqual({
      providerReference: first.providerReference,
      providerStatus: "TEST_CAPTURED",
      amountCents: input.order.amountCents,
      currency: input.order.currency,
      orderNumber: input.order.orderNumber,
      status: "paid",
    });

    expect(toImmediatePaymentActionDTO(first)).toMatchObject({
      kind: "test",
      method: "card",
      isTest: true,
    });
  });

  it("ignores browser result and rejects mismatched return data", async () => {
    const provider = createLocalTestProvider({ nodeEnv: "test", method: "afterpay" });
    const input = sessionInput();
    const session = await provider.createOrReuse(input);
    if (session.kind !== "test") throw new Error("Expected local test session");
    const hostile = new URL(session.url);
    hostile.searchParams.set("result", "paid");
    hostile.searchParams.set("state", "b".repeat(64));

    await expect(provider.completeReturn({
      order: input.order,
      providerReference: session.providerReference,
      idempotencyKey: input.idempotencyKey,
      attemptCreatedAt: new Date(),
      returnState: input.returnState,
      returnUrl: hostile,
    })).rejects.toThrow("Local test return verification failed");
    await expect(provider.completeReturn({
      order: { ...input.order, amountCents: input.order.amountCents + 1 },
      providerReference: session.providerReference,
      idempotencyKey: input.idempotencyKey,
      attemptCreatedAt: new Date(),
      returnState: new URL(session.url).searchParams.get("state")!,
      returnUrl: new URL(session.url),
    })).rejects.toThrow("Local test return verification failed");
  });

  it("mirrors Card and Afterpay eligibility", async () => {
    const cases: readonly [PaymentMethodKey, PaymentOrder, boolean][] = [
      ["card", order("NZ", "NZD"), true],
      ["afterpay", order("NZ", "NZD"), true],
      ["afterpay", order("AU", "NZD"), false],
    ];

    for (const [method, paymentOrder, expected] of cases) {
      const provider = createLocalTestProvider({ nodeEnv: "test", method });
      await expect(provider.availability(paymentOrder)).resolves.toMatchObject({
        available: expected,
      });
    }
  });
});
