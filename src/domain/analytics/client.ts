"use client";

import { sendGAEvent } from "@next/third-parties/google";
import type { AnalyticsEvent, AnalyticsItem } from "./events";
import { emitMetaAnalyticsEvent, isMetaAnalyticsRequired } from "./meta";
import {
  classifyGa4Location,
  GA4_DEBUG_SESSION_KEY,
  GA4_DISABLE_WINDOW_KEY,
  GA4_MEASUREMENT_ID,
  GA4_SAFE_CHECKOUT_PATH,
  GA4_SAFE_PURCHASE_PATH,
  GOOGLE_ADS_PURCHASE_SEND_TO,
  GOOGLE_ADS_TAG_ID,
} from "./runtime";

const GA4_EVENT_PROCESSING_WINDOW_MS = 250;
let collectionDisableTimer: number | undefined;
let pendingGaFlushTimer: number | undefined;
let gaTransportReady = false;
let gaHistorySuppressionDepth = 0;
const pendingGaEvents: Array<Readonly<{
  eventName: string;
  payload: Record<string, unknown>;
}>> = [];
const PURCHASE_DELIVERY_KEY_PREFIX = "rnr:analytics:v1:purchase-destination";

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
    ...(item.index !== undefined ? { index: item.index } : {}),
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
    case "view_item_list":
    case "select_item":
      return {
        ...commercePayload(event),
        item_list_id: event.item_list_id,
        item_list_name: event.item_list_name,
      };
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
  return window.sessionStorage.getItem(GA4_DEBUG_SESSION_KEY) === "true";
}

function isPrivatePurchaseLocation(event: AnalyticsEvent): event is Extract<AnalyticsEvent, { event: "purchase" }> {
  return event.event === "purchase"
    && document.documentElement.dataset.ga4PrivatePurchase === "true"
    && document.documentElement.dataset.ga4Loaded === "true";
}

function analyticsAllowed() {
  const root = document.documentElement.dataset;
  return root.ga4Enabled === "true" || root.ga4AnalyticsEnabled === "true";
}

function googleAdsAllowed() {
  return document.documentElement.dataset.googleAdsEnabled === "true";
}

function isPrivateCheckoutReady(event: AnalyticsEvent): boolean {
  return ["begin_checkout", "add_shipping_info", "add_payment_info"].includes(event.event)
    && document.documentElement.dataset.ga4PrivateCommerce === "true"
    && document.documentElement.dataset.ga4Loaded === "true";
}

function sendGaEventNow(
  eventName: string,
  payload: Record<string, unknown>,
): void {
  const ga4Window = window as Window & Record<string, unknown>;
  const currentLocation = new URL(window.location.href);
  const isPublicDocument = classifyGa4Location(
    currentLocation.pathname,
    currentLocation.searchParams,
  ) === "public";
  if (collectionDisableTimer !== undefined) {
    window.clearTimeout(collectionDisableTimer);
    collectionDisableTimer = undefined;
  }
  ga4Window[GA4_DISABLE_WINDOW_KEY] = false;
  try {
    sendGAEvent("event", eventName, payload);
  } catch (error) {
    suppressGaCollection();
    throw error;
  } finally {
    if (!isPublicDocument) ga4Window[GA4_DISABLE_WINDOW_KEY] = true;
  }
  if (!isPublicDocument) return;
  collectionDisableTimer = window.setTimeout(() => {
    collectionDisableTimer = undefined;
    ga4Window[GA4_DISABLE_WINDOW_KEY] = true;
  }, GA4_EVENT_PROCESSING_WINDOW_MS);
}

function safePageContext(
  payload: Record<string, unknown>,
  destination = GA4_MEASUREMENT_ID,
): Record<string, unknown> {
  let requested: URL;
  try {
    requested = new URL(
      typeof payload.page_location === "string"
        ? payload.page_location
        : window.location.href,
      window.location.origin,
    );
  } catch {
    requested = new URL(window.location.href);
  }
  const explicitSafePrivatePath = requested.pathname === GA4_SAFE_CHECKOUT_PATH
    || requested.pathname === GA4_SAFE_PURCHASE_PATH;
  const pathname = explicitSafePrivatePath
    || classifyGa4Location(requested.pathname, new URLSearchParams()) === "public"
    ? requested.pathname || "/"
    : GA4_SAFE_PURCHASE_PATH;
  return {
    ...payload,
    page_location: new URL(pathname, window.location.origin).href,
    page_referrer: "",
    send_to: destination,
  };
}

export function suppressGaCollection(): void {
  if (collectionDisableTimer !== undefined) {
    window.clearTimeout(collectionDisableTimer);
    collectionDisableTimer = undefined;
  }
  (window as Window & Record<string, unknown>)[GA4_DISABLE_WINDOW_KEY] = true;
}

function flushPendingGaEvents(): void {
  if (pendingGaFlushTimer !== undefined) {
    window.clearTimeout(pendingGaFlushTimer);
    pendingGaFlushTimer = undefined;
  }
  if (!gaTransportReady || gaHistorySuppressionDepth > 0 || pendingGaEvents.length === 0) {
    return;
  }
  const events = pendingGaEvents.splice(0);
  try {
    for (const event of events) sendGaEventNow(event.eventName, event.payload);
  } catch {
    pendingGaEvents.length = 0;
    suppressGaCollection();
  }
}

function sendControlledDestinationEvent(
  eventName: string,
  payload: Record<string, unknown>,
  destination: string,
): void {
  const event = { eventName, payload: safePageContext(payload, destination) };
  if (!gaTransportReady || gaHistorySuppressionDepth > 0 || eventName === "select_item") {
    pendingGaEvents.push(event);
    if (gaTransportReady
      && gaHistorySuppressionDepth === 0
      && pendingGaFlushTimer === undefined) {
      pendingGaFlushTimer = window.setTimeout(flushPendingGaEvents, 0);
    }
    return;
  }
  sendGaEventNow(event.eventName, event.payload);
}

export function sendControlledGaEvent(
  eventName: string,
  payload: Record<string, unknown>,
): void {
  sendControlledDestinationEvent(eventName, payload, GA4_MEASUREMENT_ID);
}

export function markGaTransportReady(): void {
  gaTransportReady = true;
  flushPendingGaEvents();
}

export function beginGaHistorySuppression(): void {
  gaHistorySuppressionDepth += 1;
  suppressGaCollection();
}

export function endGaHistorySuppression(): void {
  gaHistorySuppressionDepth = Math.max(0, gaHistorySuppressionDepth - 1);
  if (gaHistorySuppressionDepth === 0) flushPendingGaEvents();
}

export function resetGaTransport(): void {
  gaTransportReady = false;
  gaHistorySuppressionDepth = 0;
  pendingGaEvents.length = 0;
  if (pendingGaFlushTimer !== undefined) {
    window.clearTimeout(pendingGaFlushTimer);
    pendingGaFlushTimer = undefined;
  }
  suppressGaCollection();
}

function purchaseDeliveryKey(
  transactionId: string,
  destination: "ga4" | "ads",
): string {
  return `${PURCHASE_DELIVERY_KEY_PREFIX}:${destination}:${encodeURIComponent(transactionId)}`;
}

function sendPurchaseDestination(
  transactionId: string,
  destination: "ga4" | "ads",
  eventName: string,
  payload: Record<string, unknown>,
  sendTo: string,
): void {
  const deliveryKey = purchaseDeliveryKey(transactionId, destination);
  if (window.sessionStorage.getItem(deliveryKey) === "sent") return;
  if (destination === "ads") {
    const dataLayer = (window as Window & { dataLayer?: unknown[] }).dataLayer;
    if (!Array.isArray(dataLayer) || typeof dataLayer.push !== "function") {
      throw new Error("Google Ads transport is unavailable");
    }
    dataLayer.push([
      "config",
      GOOGLE_ADS_TAG_ID,
      {
        send_page_view: false,
        page_location: new URL(GA4_SAFE_PURCHASE_PATH, window.location.origin).href,
        page_referrer: "",
      },
    ]);
    dataLayer.push(["event", eventName, safePageContext(payload, sendTo)]);
    window.sessionStorage.setItem(deliveryKey, "sent");
    return;
  }
  sendGaEventNow(eventName, safePageContext(payload, sendTo));
  window.sessionStorage.setItem(deliveryKey, "sent");
}

function sendPurchaseEvent(
  event: Extract<AnalyticsEvent, { event: "purchase" }>,
  payload: Record<string, unknown>,
  sendGa4: boolean,
  sendAds: boolean,
): boolean {
  if (!gaTransportReady || gaHistorySuppressionDepth > 0) return false;
  if (sendGa4) {
    sendPurchaseDestination(event.transaction_id, "ga4", event.event, payload, GA4_MEASUREMENT_ID);
  }
  if (sendAds) {
    sendPurchaseDestination(event.transaction_id, "ads", "conversion", {
      transaction_id: event.transaction_id,
      currency: event.currency,
      value: event.total,
    }, GOOGLE_ADS_PURCHASE_SEND_TO);
  }
  return true;
}

export function emitAnalyticsEvent(event: AnalyticsEvent | null): boolean {
  try {
    if (!event || typeof document === "undefined" || !hasReadyDataLayer()) {
      return false;
    }

    const privatePurchase = isPrivatePurchaseLocation(event);
    const privateCheckout = isPrivateCheckoutReady(event);
    const sendGa4Purchase = privatePurchase && analyticsAllowed();
    const sendAdsPurchase = privatePurchase && googleAdsAllowed();
    const allowed = event.event === "purchase"
      ? sendGa4Purchase || sendAdsPurchase
      : (privateCheckout && analyticsAllowed()) || document.documentElement.dataset.ga4Enabled === "true";
    if (!allowed) {
      return false;
    }

    const payload = allowlistedPayload(event);
    if (!payload) return false;

    if (isMetaAnalyticsRequired(event)) emitMetaAnalyticsEvent(event);

    const eventPayload = {
      ...payload,
      ...(privatePurchase || privateCheckout ? {
        page_location: new URL(
          privatePurchase ? GA4_SAFE_PURCHASE_PATH : GA4_SAFE_CHECKOUT_PATH,
          window.location.origin,
        ).href,
        page_referrer: "",
      } : {}),
      ...(isDebugSession() ? { debug_mode: true } : {}),
    };
    if (event.event === "purchase") {
      return sendPurchaseEvent(event, eventPayload, sendGa4Purchase, sendAdsPurchase);
    }
    sendControlledGaEvent(event.event, eventPayload);
    return true;
  } catch {
    return false;
  }
}
