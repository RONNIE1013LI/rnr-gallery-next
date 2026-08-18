import { describe, expect, it } from "vitest";
import {
  createPaymentRequestInputSchema,
  recordBankTransferInputSchema,
  reverseLedgerEntryInputSchema,
  standalonePayerInputSchema,
} from "./input-schema";

const common = {
  amountCents: 20_000,
  currency: "NZD",
  description: "Outstanding balance",
  enabledPaymentMethods: ["card", "afterpay"],
};

describe("payment request input schemas", () => {
  it("accepts fixed Order and standalone requests", () => {
    expect(createPaymentRequestInputSchema.parse({
      ...common,
      kind: "order_balance",
      orderId: "56d0ebc3-d149-42ac-abf5-03151fcecdef",
    })).toMatchObject({ amountCents: 20_000, currency: "NZD" });
    expect(createPaymentRequestInputSchema.parse({
      ...common,
      kind: "standalone",
      customerName: "Internal only",
      customerEmail: "internal@example.test",
    })).toMatchObject({ kind: "standalone" });
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid fixed cents %s",
    (amountCents) => {
      expect(createPaymentRequestInputSchema.safeParse({
        ...common,
        kind: "standalone",
        amountCents,
      }).success).toBe(false);
    },
  );

  it("rejects unsupported currencies, duplicate methods and unknown fields", () => {
    expect(createPaymentRequestInputSchema.safeParse({
      ...common,
      kind: "standalone",
      currency: "USD",
    }).success).toBe(false);
    expect(createPaymentRequestInputSchema.safeParse({
      ...common,
      kind: "standalone",
      enabledPaymentMethods: ["card", "card"],
    }).success).toBe(false);
    expect(createPaymentRequestInputSchema.safeParse({
      ...common,
      kind: "standalone",
      partiallyPaid: true,
    }).success).toBe(false);
  });

  it("accepts a bounded bank credit and a separate reversal command", () => {
    expect(recordBankTransferInputSchema.parse({
      orderId: "56d0ebc3-d149-42ac-abf5-03151fcecdef",
      amountCents: 20_000,
      receivedAt: "2026-08-18T05:00:00.000Z",
      reference: "Wise transfer",
      idempotencyKey: "bank-transfer-1",
    })).toMatchObject({ amountCents: 20_000 });
    expect(reverseLedgerEntryInputSchema.parse({
      entryId: "ef0fa975-2050-4c43-b693-38367b1b663e",
      reason: "Recorded against the wrong order",
      idempotencyKey: "reverse-entry-1",
    })).toMatchObject({ reason: "Recorded against the wrong order" });
  });

  it("keeps public payer input free of financial authority", () => {
    const input = {
      method: "card",
      fullName: "Ronnie Li",
      email: "payer@example.test",
      idempotencyKey: "public-payment-1",
    };
    expect(standalonePayerInputSchema.parse(input)).toEqual(input);
    for (const key of ["amountCents", "currency", "requestId", "description", "enabledPaymentMethods"]) {
      expect(standalonePayerInputSchema.safeParse({ ...input, [key]: "forged" }).success)
        .toBe(false);
    }
  });

  it("requires phone and address only for Afterpay and Zip", () => {
    const base = {
      fullName: "Ronnie Li",
      email: "payer@example.test",
      idempotencyKey: "public-payment-2",
    };
    expect(standalonePayerInputSchema.safeParse({ method: "card", ...base }).success)
      .toBe(true);
    expect(standalonePayerInputSchema.safeParse({ method: "afterpay", ...base }).success)
      .toBe(false);
    expect(standalonePayerInputSchema.safeParse({
      method: "afterpay",
      ...base,
      phone: "+64 21 023 48948",
      address: {
        country: "NZ",
        building: "11",
        street: "Para Close",
        suburb: "Fairview Heights",
        region: "Auckland",
        postcode: "0632",
      },
    }).success).toBe(true);
    expect(standalonePayerInputSchema.safeParse({
      method: "zip",
      ...base,
      phone: "+64 21 023 48948",
      address: {
        country: "NZ",
        building: "11",
        street: "Para Close",
        suburb: "Fairview Heights",
        region: "Auckland",
        postcode: "0632",
      },
    }).success).toBe(false);
  });
});
