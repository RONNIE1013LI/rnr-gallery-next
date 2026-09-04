import type { ToolEvidence } from "../types";
import type { DynamicShippingQuoteRequest, ShippingQuoteReader } from "./types";

export async function dynamicShippingQuote(
  reader: ShippingQuoteReader,
  request: DynamicShippingQuoteRequest,
): Promise<ToolEvidence> {
  const { product, size, destination } = request.input;
  if (
    typeof product !== "string"
    || typeof size !== "string"
    || typeof destination !== "string"
    || !product.trim()
    || !size.trim()
    || !destination.trim()
  ) {
    throw new Error("Shipping quote requires product, size and destination");
  }
  const result = await reader.quote(request.input);
  return Object.freeze({ tool: request.name, ...result });
}
