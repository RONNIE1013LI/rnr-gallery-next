import type { ToolEvidence } from "../types";

export type CanonicalProductPriceRequest = Readonly<{
  name: "canonical_product_price";
  input: Readonly<{
    market: "NZ" | "AU";
    product: string;
    size?: string;
  }>;
}>;

export type DynamicShippingQuoteRequest = Readonly<{
  name: "dynamic_shipping_quote";
  input: Readonly<{
    market: "NZ" | "AU";
    product: string;
    size: string;
    destination: string;
  }>;
}>;

type PrivateStatusInput = Readonly<{
  customerReference: string;
  orderReference: string;
}>;

export type OrderStatusRequest = Readonly<{
  name: "order_status";
  input: PrivateStatusInput;
}>;

export type PaymentStatusRequest = Readonly<{
  name: "payment_status";
  input: PrivateStatusInput;
}>;

export type PrivateStatusRequest = Readonly<{
  name: "order_status" | "payment_status";
  input: Readonly<{
    customerReference: string;
    orderReference: string;
  }>;
}>;

export type BusinessToolRequest =
  | CanonicalProductPriceRequest
  | DynamicShippingQuoteRequest
  | OrderStatusRequest
  | PaymentStatusRequest;

export type LiveToolResult = Pick<ToolEvidence, "status" | "source" | "facts">;

export interface ShippingQuoteReader {
  quote(input: DynamicShippingQuoteRequest["input"]): Promise<LiveToolResult>;
}

export interface OrderStatusReader {
  read(input: PrivateStatusInput): Promise<LiveToolResult>;
}

export interface PaymentStatusReader {
  read(input: PrivateStatusInput): Promise<LiveToolResult>;
}
