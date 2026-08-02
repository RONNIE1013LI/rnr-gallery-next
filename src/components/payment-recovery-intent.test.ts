import { describe, expect, it } from "vitest";
import {
  PAYMENT_INTENT_STORAGE_KEY,
  parsePaymentRecoveryIntent,
  readPaymentRecoveryIntent,
} from "./payment-recovery-intent";

const rich = {
  schemaVersion: 1,
  phase: "starting_payment",
  orderIdempotencyKey: "70000000-0000-4000-8000-000000000001",
  paymentIdempotencyKey: "80000000-0000-4000-8000-000000000001",
  method: "afterpay",
  checkoutVersion: 2,
  cartDigest: "a".repeat(64),
  shipping: { method: "post", serviceCode: "NZ-NORTH_1", amountExGstCents: 2000, gstCents: 300, amountInclGstCents: 2300, isTest: false },
  orderNumber: "RNR-2026-ABC123",
} as const;

describe("payment recovery intent", () => {
  it("accepts exact minimal direct-order and rich checkout starting records", () => {
    expect(parsePaymentRecoveryIntent(JSON.stringify({
      schemaVersion: 1,
      phase: "starting_payment",
      orderNumber: "RNR-2026-ABC123",
      paymentIdempotencyKey: "80000000-0000-4000-8000-000000000001",
      method: "card",
    }))).toEqual({
      schemaVersion: 1,
      phase: "starting_payment",
      orderNumber: "RNR-2026-ABC123",
      paymentIdempotencyKey: "80000000-0000-4000-8000-000000000001",
      method: "card",
    });
    expect(parsePaymentRecoveryIntent(JSON.stringify(rich))).toEqual(rich);
    const placing = {
      schemaVersion: rich.schemaVersion,
      phase: rich.phase,
      orderIdempotencyKey: rich.orderIdempotencyKey,
      paymentIdempotencyKey: rich.paymentIdempotencyKey,
      method: rich.method,
      checkoutVersion: rich.checkoutVersion,
      cartDigest: rich.cartDigest,
      shipping: rich.shipping,
    };
    expect(parsePaymentRecoveryIntent(JSON.stringify({ ...placing, phase: "placing_order" }))).toEqual({
      ...placing,
      phase: "placing_order",
    });
  });

  it.each([
    { ...rich, secret: "must-not-persist" },
    { ...rich, paymentIdempotencyKey: "bad" },
    { ...rich, orderIdempotencyKey: rich.paymentIdempotencyKey },
    { ...rich, checkoutVersion: 0 },
    { ...rich, cartDigest: "A".repeat(64) },
    { ...rich, orderNumber: "bad/order" },
    { ...rich, shipping: { ...rich.shipping, method: "courier" } },
    { ...rich, shipping: { ...rich.shipping, serviceCode: "bad\ncode" } },
    { ...rich, shipping: { ...rich.shipping, amountExGstCents: -1 } },
    { ...rich, shipping: { ...rich.shipping, amountInclGstCents: 999 } },
    { ...rich, shipping: { ...rich.shipping, isTest: "false" } },
    { ...rich, shipping: { ...rich.shipping, providerSecret: "secret" } },
  ])("rejects malformed or sensitive rich records", (candidate) => {
    expect(parsePaymentRecoveryIntent(JSON.stringify(candidate))).toBeNull();
  });

  it("removes invalid storage instead of retaining or replaying it", () => {
    sessionStorage.setItem(PAYMENT_INTENT_STORAGE_KEY, JSON.stringify({
      schemaVersion: 1,
      phase: "starting_payment",
      orderNumber: "RNR-2026-ABC123",
      paymentIdempotencyKey: "80000000-0000-4000-8000-000000000001",
      method: "card",
      clientSecret: "must-not-remain",
    }));

    expect(readPaymentRecoveryIntent(sessionStorage)).toBeNull();
    expect(sessionStorage.getItem(PAYMENT_INTENT_STORAGE_KEY)).toBeNull();
  });
});
