import type {
  PaymentLedgerDirection,
  PaymentLedgerEntryType,
} from "@/server/db/schema/payments";

type LedgerAmount = Readonly<{
  direction: PaymentLedgerDirection;
  amountCents: number;
}>;

export function calculateLedgerBalance(
  totalCents: number,
  entries: readonly LedgerAmount[],
): Readonly<{ netPaidCents: number; outstandingCents: number }> {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) {
    throw new Error("Invalid order total");
  }
  const netPaidCents = entries.reduce((total, entry) => {
    if (!Number.isSafeInteger(entry.amountCents) || entry.amountCents <= 0) {
      throw new Error("Invalid ledger amount");
    }
    return total + (entry.direction === "credit" ? entry.amountCents : -entry.amountCents);
  }, 0);
  return Object.freeze({
    netPaidCents,
    outstandingCents: Math.max(totalCents - netPaidCents, 0),
  });
}

type Reservation = Readonly<{
  id: string;
  amountCents: number;
  createdAt: Date;
}>;

export function reconcileReservations(
  outstandingCents: number,
  requests: readonly Reservation[],
): Readonly<{
  payableIds: readonly string[];
  invalidatedIds: readonly string[];
  reservedCents: number;
}> {
  if (!Number.isSafeInteger(outstandingCents) || outstandingCents < 0) {
    throw new Error("Invalid outstanding balance");
  }
  const ordered = [...requests].sort((left, right) =>
    left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id));
  const payableIds: string[] = [];
  const invalidatedIds: string[] = [];
  let reservedCents = 0;
  for (const request of ordered) {
    if (!Number.isSafeInteger(request.amountCents) || request.amountCents <= 0) {
      throw new Error("Invalid reservation amount");
    }
    if (reservedCents + request.amountCents <= outstandingCents) {
      payableIds.push(request.id);
      reservedCents += request.amountCents;
    } else {
      invalidatedIds.push(request.id);
    }
  }
  return Object.freeze({
    payableIds: Object.freeze(payableIds),
    invalidatedIds: Object.freeze(invalidatedIds),
    reservedCents,
  });
}

type ReversibleLedgerEntry = Readonly<{
  id: string;
  entryType: PaymentLedgerEntryType;
  direction: PaymentLedgerDirection;
  amountCents: number;
  currency: "NZD" | "AUD";
  orderId: string | null;
}>;

export function validateLedgerReversal(
  entry: ReversibleLedgerEntry,
  alreadyReversed: boolean,
): Readonly<{
  orderId: string;
  amountCents: number;
  currency: "NZD" | "AUD";
  reversesEntryId: string;
}> {
  if (alreadyReversed) throw new Error("Ledger entry is already reversed");
  if (
    entry.entryType !== "bank_transfer" ||
    entry.direction !== "credit" ||
    !entry.orderId
  ) {
    throw new Error("Ledger entry is not reversible");
  }
  return Object.freeze({
    orderId: entry.orderId,
    amountCents: entry.amountCents,
    currency: entry.currency,
    reversesEntryId: entry.id,
  });
}
