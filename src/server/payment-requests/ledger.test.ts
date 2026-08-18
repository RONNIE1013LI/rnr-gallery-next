import { describe, expect, it } from "vitest";
import {
  calculateLedgerBalance,
  reconcileReservations,
  validateLedgerReversal,
} from "./ledger";

describe("payment ledger rules", () => {
  it("calculates net paid and outstanding from immutable credits and debits", () => {
    expect(calculateLedgerBalance(40_000, [
      { direction: "credit", amountCents: 20_000 },
      { direction: "debit", amountCents: 5_000 },
    ])).toEqual({ netPaidCents: 15_000, outstandingCents: 25_000 });
  });

  it("never returns a negative outstanding balance", () => {
    expect(calculateLedgerBalance(10_000, [
      { direction: "credit", amountCents: 12_000 },
    ])).toEqual({ netPaidCents: 12_000, outstandingCents: 0 });
  });

  it("keeps oldest fitting reservations and invalidates the rest deterministically", () => {
    expect(reconcileReservations(20_000, [
      { id: "b", amountCents: 10_000, createdAt: new Date("2026-01-02") },
      { id: "a", amountCents: 12_000, createdAt: new Date("2026-01-01") },
      { id: "c", amountCents: 8_000, createdAt: new Date("2026-01-03") },
    ])).toEqual({
      payableIds: ["a", "c"],
      invalidatedIds: ["b"],
      reservedCents: 20_000,
    });
  });

  it("validates one exact reversal of a reversible credit", () => {
    const credit = {
      id: "entry-1",
      entryType: "bank_transfer" as const,
      direction: "credit" as const,
      amountCents: 20_000,
      currency: "NZD" as const,
      orderId: "order-1",
    };
    expect(validateLedgerReversal(credit, false)).toEqual({
      orderId: "order-1",
      amountCents: 20_000,
      currency: "NZD",
      reversesEntryId: "entry-1",
    });
    expect(() => validateLedgerReversal(credit, true)).toThrow("already reversed");
    expect(() => validateLedgerReversal({ ...credit, direction: "debit" }, false))
      .toThrow("not reversible");
  });
});
