import type { PaymentRequestStatus } from "@/server/db/schema/payments";

export function effectivePaymentRequestStatus(
  request: Readonly<{
    status: PaymentRequestStatus;
    expiresAt: Date | null;
  }>,
): PaymentRequestStatus {
  return request.status;
}

export function isPaymentRequestTransitionAllowed(
  from: PaymentRequestStatus,
  to: PaymentRequestStatus,
): boolean {
  return from === "pending" && to !== "pending";
}
