"use client";

import { sendGAEvent } from "@next/third-parties/google";
import type { AnalyticsEvent, AnalyticsItem } from "./events";
import { GA4_DEBUG_SESSION_KEY } from "./runtime";

function allowlistedItem(item: AnalyticsItem): Record<string, unknown> {
  return {
    item_id: item.item_id,
    item_name: item.item_name,
    ...(item.item_category !== undefined
      ? { item_category: item.item_category }
      : {}),
    ...(item.item_variant !== undefined
      ? { item_variant: item.item_variant }
      : {}),
    price: item.price,
    quantity: item.quantity,
  };
}

function commercePayload(event: Extract<AnalyticsEvent, { currency: unknown }>) {
  return {
    currency: event.currency,
    value: event.value,
    items: event.items.map(allowlistedItem),
  };
}

function allowlistedPayload(event: AnalyticsEvent): Record<string, unknown> | null {
  switch (event.event) {
    case "view_item":
    case "add_to_cart":
    case "remove_from_cart":
    case "view_cart":
    case "begin_checkout":
      return commercePayload(event);
    case "add_shipping_info":
      return {
        ...commercePayload(event),
        ...(event.shipping_tier !== undefined
          ? { shipping_tier: event.shipping_tier }
          : {}),
      };
    case "add_payment_info":
      return {
        ...commercePayload(event),
        ...(event.payment_type !== undefined
          ? { payment_type: event.payment_type }
          : {}),
      };
    case "purchase":
      return {
        transaction_id: event.transaction_id,
        currency: event.currency,
        value: event.value,
        tax: event.tax,
        shipping: event.shipping,
        items: event.items.map(allowlistedItem),
      };
    case "generate_lead":
      return { method: event.method };
    case "messenger_click":
      return { location: event.location };
    case "photo_upload_completed":
      return {
        product_id: event.product_id,
        photo_count: event.photo_count,
      };
    case "send_photos_later_selected":
      return { product_id: event.product_id };
    case "design_selected":
      return {
        design_id: event.design_id,
        product_id: event.product_id,
      };
    default:
      return null;
  }
}

function hasReadyDataLayer(): boolean {
  const dataLayer = (window as Window & { dataLayer?: unknown }).dataLayer;
  return !!dataLayer && typeof (dataLayer as { push?: unknown }).push === "function";
}

function isDebugSession(): boolean {
  const control = new URLSearchParams(window.location.search).get("ga_debug");
  if (control === "1") {
    window.sessionStorage.setItem(GA4_DEBUG_SESSION_KEY, "true");
  } else if (control === "0") {
    window.sessionStorage.removeItem(GA4_DEBUG_SESSION_KEY);
  }
  return window.sessionStorage.getItem(GA4_DEBUG_SESSION_KEY) === "true";
}

export function emitAnalyticsEvent(event: AnalyticsEvent | null): boolean {
  if (
    !event
    || typeof document === "undefined"
    || document.documentElement.dataset.ga4Enabled !== "true"
    || !hasReadyDataLayer()
  ) {
    return false;
  }

  const payload = allowlistedPayload(event);
  if (!payload) return false;
  sendGAEvent("event", event.event, {
    ...payload,
    ...(isDebugSession() ? { debug_mode: true } : {}),
  });
  return true;
}
