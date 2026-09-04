import type { ToolEvidence } from "../types";
import type { PaymentStatusReader, PaymentStatusRequest } from "./types";

export async function readPaymentStatus(
  reader: PaymentStatusReader,
  request: PaymentStatusRequest,
): Promise<ToolEvidence> {
  if (typeof request.input.customerReference !== "string" || !request.input.customerReference.trim()) {
    throw new Error("Payment status requires a verified customer reference");
  }
  if (typeof request.input.orderReference !== "string" || !request.input.orderReference.trim()) {
    throw new Error("Payment status requires an order reference");
  }
  return Object.freeze({ tool: request.name, ...await reader.read(request.input) });
}
