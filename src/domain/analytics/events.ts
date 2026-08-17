import type { PublicOrder } from "@/server/orders/order-query-service";
import type { MarketCurrency } from "@/domain/markets/types";

export type AnalyticsItem = Readonly<{
  item_id: string;
  item_name: string;
  item_category?: string;
  item_variant?: string;
  price: number;
  quantity: number;
}>;

type CommerceEventName = "view_item_list" | "select_item" | "view_item" | "add_to_cart" | "view_cart" | "begin_checkout";
type CommerceEvent = Readonly<{ event: CommerceEventName; currency: MarketCurrency; value: number; items: readonly AnalyticsItem[] }>;
type SimpleEvent =
  | Readonly<{ event: "generate_lead"; method: string }>
  | Readonly<{ event: "messenger_click"; location: string }>
  | Readonly<{ event: "photo_upload_completed"; product_id: string; photo_count: number }>
  | Readonly<{ event: "send_photos_later_selected"; product_id: string }>
  | Readonly<{ event: "design_selected"; design_id: string; product_id: string }>;
export type PurchaseEvent = Readonly<{
  event: "purchase";
  transaction_id: string;
  currency: MarketCurrency;
  value: number;
  tax: number;
  shipping: number;
  items: readonly AnalyticsItem[];
}>;
export type AnalyticsEvent = CommerceEvent | SimpleEvent | PurchaseEvent;

declare global {
  interface Window {
    dataLayer?: AnalyticsEvent[];
  }
}

function dollars(cents: number) {
  return Number((cents / 100).toFixed(2));
}

export function buildPurchaseEvent(order: PublicOrder): PurchaseEvent | null {
  if (order.paymentStatus !== "paid") return null;
  return Object.freeze({
    event: "purchase",
    transaction_id: order.orderNumber,
    currency: order.currency,
    value: dollars(order.totals.totalInclGstCents),
    tax: dollars(order.totals.totalGstCents),
    shipping: dollars(order.shipping.amountInclGstCents),
    items: order.items.map((item) => Object.freeze({
      item_id: item.productKey,
      item_name: item.productTitle,
      item_variant: item.sizeKey,
      price: dollars(item.unitTotalInclGstCents),
      quantity: item.quantity,
    })),
  });
}

export function emitAnalyticsEvent(event: AnalyticsEvent): boolean {
  if (typeof window === "undefined" || process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ENABLED !== "true") return false;
  window.dataLayer ??= [];
  window.dataLayer.push(event);
  return true;
}
