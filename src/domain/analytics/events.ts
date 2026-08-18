import type { Cart, CartItem } from "@/domain/cart/types";
import type { RepricedCheckoutCart } from "@/domain/checkout/types";
import type { MarketCurrency } from "@/domain/markets/types";
import type { MarketPriceBreakdown } from "@/domain/pricing/types";
import type { PublicOrder } from "@/server/orders/order-query-service";

export type AnalyticsItem = Readonly<{
  item_id: string;
  item_name: string;
  item_category?: string;
  item_variant?: string;
  price: number;
  quantity: number;
}>;

type CommerceEventName =
  | "view_item"
  | "add_to_cart"
  | "remove_from_cart"
  | "view_cart"
  | "begin_checkout"
  | "add_shipping_info"
  | "add_payment_info";

export type CommerceEvent = Readonly<{
  event: CommerceEventName;
  currency: MarketCurrency;
  value: number;
  items: readonly AnalyticsItem[];
  shipping_tier?: string;
  payment_type?: "card" | "afterpay";
}>;

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

export type ProductViewAnalyticsInput = Readonly<{
  productKey: string;
  productName: string;
  category?: string;
  sizeKey: string;
  currency: MarketCurrency;
  unitSubtotalExTaxCents: number;
}>;

export type CheckoutAnalyticsDetails = Readonly<{
  shipping_tier?: string;
  payment_type?: "card" | "afterpay";
}>;

function isSafeCents(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function dollars(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

function assertSafeCents(value: number): void {
  if (!isSafeCents(value)) {
    throw new RangeError("Analytics money must be non-negative safe integer cents.");
  }
}

function isSafeQuantity(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function currencyFromItem(item: CartItem): MarketCurrency | null {
  const currency = (item.price as Partial<MarketPriceBreakdown>).currency ?? "NZD";
  return currency === "NZD" || currency === "AUD" ? currency : null;
}

function itemPayload(input: Readonly<{
  productKey: string;
  productName: string;
  category?: string;
  sizeKey?: string;
  unitSubtotalCents: number;
  quantity: number;
}>): AnalyticsItem {
  assertSafeCents(input.unitSubtotalCents);
  if (!isSafeQuantity(input.quantity)) {
    throw new RangeError("Analytics quantity must be a positive safe integer.");
  }

  return Object.freeze({
    item_id: input.productKey,
    item_name: input.productName,
    ...(input.category ? { item_category: input.category } : {}),
    ...(input.sizeKey ? { item_variant: input.sizeKey } : {}),
    price: dollars(input.unitSubtotalCents),
    quantity: input.quantity,
  });
}

function commerceEvent(
  event: CommerceEventName,
  currency: MarketCurrency,
  items: readonly AnalyticsItem[],
  valueCents: number,
  details: CheckoutAnalyticsDetails = {},
): CommerceEvent {
  assertSafeCents(valueCents);
  return Object.freeze({
    event,
    currency,
    value: dollars(valueCents),
    items: Object.freeze([...items]),
    ...(details.shipping_tier ? { shipping_tier: details.shipping_tier } : {}),
    ...(details.payment_type ? { payment_type: details.payment_type } : {}),
  });
}

export function buildProductViewEvent(
  input: ProductViewAnalyticsInput,
): CommerceEvent {
  const item = itemPayload({
    productKey: input.productKey,
    productName: input.productName,
    category: input.category,
    sizeKey: input.sizeKey,
    unitSubtotalCents: input.unitSubtotalExTaxCents,
    quantity: 1,
  });
  return commerceEvent(
    "view_item",
    input.currency,
    [item],
    input.unitSubtotalExTaxCents,
  );
}

export function buildCartItemEvent(
  name: "add_to_cart" | "remove_from_cart",
  item: CartItem,
): CommerceEvent {
  const currency = currencyFromItem(item);
  if (!currency) throw new RangeError("Cart item currency is not supported.");
  assertSafeCents(item.price.subtotalExGstCents);
  if (!isSafeQuantity(item.quantity)) {
    throw new RangeError("Analytics quantity must be a positive safe integer.");
  }
  const valueCents = item.price.subtotalExGstCents * item.quantity;
  assertSafeCents(valueCents);
  return commerceEvent(name, currency, [itemPayload({
    productKey: item.productKey,
    productName: item.productTitle,
    sizeKey: item.sizeKey,
    unitSubtotalCents: item.price.subtotalExGstCents,
    quantity: item.quantity,
  })], valueCents);
}

export function buildCartEvent(
  name: "view_cart" | "begin_checkout",
  cart: Cart,
): CommerceEvent | null {
  if (cart.items.length === 0) return null;
  const currencies = cart.items.map(currencyFromItem);
  const currency = currencies[0];
  if (!currency || currencies.some((candidate) => candidate !== currency)) return null;

  const items: AnalyticsItem[] = [];
  let valueCents = 0;
  for (const item of cart.items) {
    if (!isSafeCents(item.price.subtotalExGstCents) || !isSafeQuantity(item.quantity)) {
      return null;
    }
    const lineValueCents = item.price.subtotalExGstCents * item.quantity;
    if (!isSafeCents(lineValueCents) || !isSafeCents(valueCents + lineValueCents)) {
      return null;
    }
    valueCents += lineValueCents;
    items.push(itemPayload({
      productKey: item.productKey,
      productName: item.productTitle,
      sizeKey: item.sizeKey,
      unitSubtotalCents: item.price.subtotalExGstCents,
      quantity: item.quantity,
    }));
  }

  return commerceEvent(name, currency, items, valueCents);
}

export function buildCheckoutEvent(
  name: "add_shipping_info" | "add_payment_info",
  cart: RepricedCheckoutCart,
  details: CheckoutAnalyticsDetails,
): CommerceEvent {
  const items = cart.items.map((item) => itemPayload({
    productKey: item.productKey,
    productName: item.productTitle,
    sizeKey: item.sizeKey,
    unitSubtotalCents: item.unitPrice.subtotalExGstCents,
    quantity: item.quantity,
  }));
  return commerceEvent(name, cart.currency, items, cart.subtotalExGstCents, details);
}

export function buildPurchaseEvent(order: PublicOrder): PurchaseEvent | null {
  if (
    order.paymentStatus !== "paid"
    || order.items.length === 0
    || !order.orderNumber
    || !isSafeCents(order.totals.productSubtotalExGstCents)
    || !isSafeCents(order.totals.totalGstCents)
    || !isSafeCents(order.shipping.amountInclGstCents)
  ) {
    return null;
  }

  const items: AnalyticsItem[] = [];
  let itemSubtotalCents = 0;
  for (const item of order.items) {
    if (!isSafeCents(item.unitSubtotalExGstCents) || !isSafeQuantity(item.quantity)) {
      return null;
    }
    const lineValueCents = item.unitSubtotalExGstCents * item.quantity;
    if (!isSafeCents(lineValueCents) || !isSafeCents(itemSubtotalCents + lineValueCents)) {
      return null;
    }
    itemSubtotalCents += lineValueCents;
    items.push(itemPayload({
      productKey: item.productKey,
      productName: item.productTitle,
      sizeKey: item.sizeKey,
      unitSubtotalCents: item.unitSubtotalExGstCents,
      quantity: item.quantity,
    }));
  }
  if (itemSubtotalCents !== order.totals.productSubtotalExGstCents) return null;

  return Object.freeze({
    event: "purchase",
    transaction_id: order.orderNumber,
    currency: order.currency,
    value: dollars(order.totals.productSubtotalExGstCents),
    tax: dollars(order.totals.totalGstCents),
    shipping: dollars(order.shipping.amountInclGstCents),
    items: Object.freeze(items),
  });
}
