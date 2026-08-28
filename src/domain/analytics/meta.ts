"use client";

import type { AnalyticsEvent, AnalyticsItem } from "./events";
import {
  buildMetaEventId,
  type MetaBrowserEvent,
  toMetaBrowserEvent,
} from "./meta-event";
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

function sendServerCopy(event: MetaBrowserEvent) {
  try {
    void fetch("/api/analytics/meta", {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      redirect: "error",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    }).catch(() => undefined);
  } catch {
    // Measurement is always best effort.
  }
}

function pairedBrowserEvent(
  fbq: MetaPixelCommand,
  pixelName: string,
  payload: Record<string, unknown>,
  event: MetaBrowserEvent,
) {
  fbq("trackSingle", META_PIXEL_ID, pixelName, payload, { eventID: event.eventId });
  sendServerCopy(event);
}

export function emitMetaPageView(sourcePath: string): boolean {
  try {
    const fbq = metaPixel();
    if (!fbq || !isPublicMetaReady()) return false;
    const event: MetaBrowserEvent = Object.freeze({
      version: 1,
      eventId: crypto.randomUUID(),
      name: "PageView",
      sourcePath: new URL(sourcePath, window.location.origin).pathname,
    });
    pairedBrowserEvent(fbq, "PageView", {}, event);
    return true;
  } catch {
    return false;
  }
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

    const eventId = buildMetaEventId(event);
    const browserEvent = toMetaBrowserEvent(event, eventId, window.location.pathname);

    switch (event.event) {
      case "view_item": {
        if (!browserEvent) return false;
        pairedBrowserEvent(fbq, "ViewContent", commercePayload(event), browserEvent);
        return true;
      }
      case "add_to_cart": {
        if (!browserEvent) return false;
        pairedBrowserEvent(fbq, "AddToCart", commercePayload(event), browserEvent);
        return true;
      }
      case "begin_checkout": {
        if (!browserEvent) return false;
        pairedBrowserEvent(fbq, "InitiateCheckout", commercePayload(event), browserEvent);
        return true;
      }
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
      case "generate_lead": {
        if (!browserEvent) return false;
        pairedBrowserEvent(fbq, "Lead", {}, browserEvent);
        return true;
      }
      case "messenger_click": {
        if (!browserEvent) return false;
        pairedBrowserEvent(fbq, "Contact", {}, browserEvent);
        return true;
      }
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
