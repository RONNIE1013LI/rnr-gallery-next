import type { ToolEvidence } from "../types";
import type { OrderStatusReader, OrderStatusRequest } from "./types";

export async function readOrderStatus(
  reader: OrderStatusReader,
  request: OrderStatusRequest,
): Promise<ToolEvidence> {
  if (typeof request.input.customerReference !== "string" || !request.input.customerReference.trim()) {
    throw new Error("Order status requires a verified customer reference");
  }
  if (typeof request.input.orderReference !== "string" || !request.input.orderReference.trim()) {
    throw new Error("Order status requires an order reference");
  }
  return Object.freeze({ tool: request.name, ...await reader.read(request.input) });
}
