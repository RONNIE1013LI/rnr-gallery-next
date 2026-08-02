import type { OrderPaymentStatus } from "@/server/db/schema/orders";
import type { VerifiedPaymentStatus } from "./types";

export type PaymentVerificationSource =
  | "browser_return"
  | "server_capture"
  | "verified_webhook"
  | "reconciliation";

const TRUSTED_PAID_SOURCES = new Set<PaymentVerificationSource>([
  "server_capture",
  "verified_webhook",
  "reconciliation",
]);

export function verifiedIncomingStatus(
  source: PaymentVerificationSource,
  incoming: VerifiedPaymentStatus,
): VerifiedPaymentStatus {
  if (incoming === "paid" && !TRUSTED_PAID_SOURCES.has(source)) {
    return "processing";
  }

  return incoming;
}

export function nextOrderPaymentStatus(
  current: OrderPaymentStatus,
  incoming: OrderPaymentStatus,
): OrderPaymentStatus {
  if (current === "refunded") {
    return "refunded";
  }

  if (current === "paid") {
    return incoming === "refunded" ? "refunded" : "paid";
  }

  if (
    current === "cancelled" &&
    incoming !== "processing" &&
    incoming !== "paid"
  ) {
    return "cancelled";
  }

  if (incoming === "awaiting_payment") {
    return current;
  }

  if (incoming === "refunded") {
    return current;
  }

  return incoming;
}
