import type { CompiledBusinessBrain } from "../business-brain/schema";
import type { ToolEvidence } from "../types";
import { readOrderStatus } from "./order-status-tool";
import { readPaymentStatus } from "./payment-status-tool";
import { canonicalProductPrice } from "./product-price-tool";
import { dynamicShippingQuote } from "./shipping-tool";
import type {
  BusinessToolRequest,
  OrderStatusReader,
  PaymentStatusReader,
  ShippingQuoteReader,
} from "./types";

const allowedTools = new Set([
  "canonical_product_price",
  "dynamic_shipping_quote",
  "order_status",
  "payment_status",
]);

export class BusinessToolRegistry {
  private readonly businessBrain: CompiledBusinessBrain;
  private readonly shipping: ShippingQuoteReader;
  private readonly orderStatus: OrderStatusReader;
  private readonly paymentStatus: PaymentStatusReader;

  constructor(input: Readonly<{
    businessBrain: CompiledBusinessBrain;
    shipping: ShippingQuoteReader;
    orderStatus: OrderStatusReader;
    paymentStatus: PaymentStatusReader;
  }>) {
    this.businessBrain = input.businessBrain;
    this.shipping = input.shipping;
    this.orderStatus = input.orderStatus;
    this.paymentStatus = input.paymentStatus;
  }

  async execute(request: BusinessToolRequest): Promise<ToolEvidence> {
    const name = (request as { name?: unknown }).name;
    if (typeof name !== "string" || !allowedTools.has(name)) {
      throw new Error("Unsupported business tool");
    }
    switch (request.name) {
      case "canonical_product_price":
        return canonicalProductPrice(this.businessBrain, request);
      case "dynamic_shipping_quote":
        return dynamicShippingQuote(this.shipping, request);
      case "order_status":
        return readOrderStatus(this.orderStatus, request);
      case "payment_status":
        return readPaymentStatus(this.paymentStatus, request);
    }
  }
}
