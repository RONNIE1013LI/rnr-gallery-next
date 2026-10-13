export type ReservationStatus = "reserved" | "consumed" | "released" | "restocked";
export function inventoryTransition(current: ReservationStatus, payment: string, canRestock: boolean, stockShortage = false, attempts?: { currentAttemptId: string | null; incomingAttemptId: string }): { next: ReservationStatus; stockDelta: "none" | "restore" | "reacquire" } | null {
  if ((payment === "failed" || payment === "cancelled") && attempts?.currentAttemptId && attempts.currentAttemptId !== attempts.incomingAttemptId) return null;
  if (payment === "paid") {
    if (current === "reserved") return { next: "consumed", stockDelta: "none" };
    if (current === "consumed" && stockShortage) return { next: "consumed", stockDelta: "reacquire" };
    if (current === "released") return { next: "consumed", stockDelta: "reacquire" };
  }
  if ((payment === "failed" || payment === "cancelled" || payment === "refunded") && current === "reserved") {
    return { next: "released", stockDelta: "restore" };
  }
  if (payment === "refunded" && current === "consumed" && canRestock) {
    return { next: "restocked", stockDelta: "restore" };
  }
  return null;
}
export function supplyPaymentNeedsHold(paymentStatus: string, fulfilmentStatus: string, stockShortage: boolean): boolean {
  return stockShortage || (paymentStatus === "paid" && fulfilmentStatus === "cancelled");
}
