"use client";

import type { AnalyticsEvent, AnalyticsItem } from "./events";
import { META_PIXEL_ID } from "./runtime";

type MetaPixelCommand = (...args: unknown[]) => void;
type MetaWindow = Window & { fbq?: MetaPixelCommand };

const PURCHASE_DELIVERY_KEY_PREFIX = "rnr:analytics:v1:purchase-destination:meta";

function metaPixel(): MetaPixelCommand | null {
  return typeof (window as MetaWindow).fbq === "function"
    ? (window as MetaWindow).fbq ?? null
    : null;
}

function contents(items: readonly AnalyticsItem[]) {
  return items.map((item) => ({
    id: item.item_id,
    quantity: item.quantity,
    item_price: item.price,
  }));
}

function commercePayload(
  event: Extract<AnalyticsEvent, { currency: unknown; items: readonly AnalyticsItem[] }>,
  value = event.value,
) {
  return {
    content_ids: event.items.map((item) => item.item_id),
    content_type: "product",
    contents: contents(event.items),
    currency: event.currency,
    value,
  };
}

function isPublicMetaReady() {
  return document.documentElement.dataset.metaEnabled === "true";
}

function isPrivateCommerceReady() {
  return document.documentElement.dataset.metaPrivateCommerce === "true";
}

function isPrivatePurchaseReady() {
  return document.documentElement.dataset.metaPrivatePurchase === "true";
}

export function isMetaAnalyticsRequired(event: AnalyticsEvent): boolean {
  if (event.event === "purchase") return isPrivatePurchaseReady() || isPublicMetaReady();
  if (["begin_checkout", "add_shipping_info", "add_payment_info"].includes(event.event)) {
    return isPrivateCommerceReady() || isPublicMetaReady();
  }
  return isPublicMetaReady();
}

export function emitMetaAnalyticsEvent(event: AnalyticsEvent): boolean {
  try {
    if (typeof window === "undefined" || !isMetaAnalyticsRequired(event)) return false;
    const fbq = metaPixel();
    if (!fbq) return false;

    switch (event.event) {
      case "view_item":
        fbq("trackSingle", META_PIXEL_ID, "ViewContent", commercePayload(event));
        return true;
      case "add_to_cart":
        fbq("trackSingle", META_PIXEL_ID, "AddToCart", commercePayload(event));
        return true;
      case "begin_checkout":
        fbq("trackSingle", META_PIXEL_ID, "InitiateCheckout", commercePayload(event));
        return true;
      case "add_payment_info":
        fbq("trackSingle", META_PIXEL_ID, "AddPaymentInfo", commercePayload(event));
        return true;
      case "purchase": {
        const key = `${PURCHASE_DELIVERY_KEY_PREFIX}:${encodeURIComponent(event.transaction_id)}`;
        if (window.sessionStorage.getItem(key) === "sent") return true;
        fbq(
          "trackSingle",
          META_PIXEL_ID,
          "Purchase",
          commercePayload(event, event.total),
          { eventID: `purchase:${event.transaction_id}` },
        );
        window.sessionStorage.setItem(key, "sent");
        return true;
      }
      case "generate_lead":
        fbq("trackSingle", META_PIXEL_ID, "Lead");
        return true;
      case "messenger_click":
        fbq("trackSingle", META_PIXEL_ID, "Contact");
        return true;
      default:
        return false;
    }
  } catch {
    return false;
  }
}

export function resetMetaPixelForTests(): void {
  // The transport is stateless apart from browser session delivery keys.
}
