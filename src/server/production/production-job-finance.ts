import type { OrderPaymentStatus } from "@/server/db/schema";

export function projectWebOrderFinance(
  totalInclGstCents: number,
  paymentStatus: OrderPaymentStatus,
) {
  const wasPaid = paymentStatus === "paid" || paymentStatus === "refunded";
  const remainsPayable = paymentStatus === "awaiting_payment" ||
    paymentStatus === "processing" || paymentStatus === "failed";
  return Object.freeze({
    amountPayableCents: totalInclGstCents,
    amountPaidCents: wasPaid ? totalInclGstCents : 0,
    amountOwingCents: remainsPayable ? totalInclGstCents : 0,
    artistFeeCents: null,
    materialCostCents: null,
    actualProfitCents: null,
  });
}
