import { and, asc, eq } from "drizzle-orm";
import type { StoredOrderAttribution } from "@/domain/analytics/attribution";
import type { MarketCurrency } from "@/domain/markets/types";
import { getSafePublicContent } from "@/server/admin/admin-content-runtime";
import {
  createMetaCapiClient,
  hashMetaEmail,
  hashMetaPhone,
  type SafeMetaEvent,
} from "@/server/analytics/meta-capi-client";
import { getDatabase } from "@/server/db/client";
import { orderAddresses, orderItems, orders, type OrderPaymentStatus } from "@/server/db/schema";

export type MetaPaidOrderSnapshot = Readonly<{
  orderNumber: string;
  paymentStatus: OrderPaymentStatus;
  currency: MarketCurrency;
  totalInclGstCents: number;
  customerEmail: string;
  customerPhone: string;
  attribution: StoredOrderAttribution | null;
  items: readonly Readonly<{
    productKey: string;
    quantity: number;
    unitSubtotalExGstCents: number;
  }>[];
}>;

type MetaSendResult = "disabled" | "sent" | "failed";

function safeCents(value: number) {
  return Number.isSafeInteger(value) && value >= 0;
}

function buildPurchase(
  order: MetaPaidOrderSnapshot,
  now: Date,
): SafeMetaEvent | null {
  const measurement = order.attribution?.measurement;
  if (order.paymentStatus !== "paid"
    || !measurement?.advertisingConsent
    || (order.currency !== "NZD" && order.currency !== "AUD")
    || !safeCents(order.totalInclGstCents)
    || order.items.length === 0) return null;
  const contentIds: string[] = [];
  const contents: Array<{ id: string; quantity: number; itemPrice: number }> = [];
  for (const item of order.items) {
    if (!item.productKey || item.productKey.length > 100
      || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 100
      || !safeCents(item.unitSubtotalExGstCents)) return null;
    contentIds.push(item.productKey);
    contents.push({
      id: item.productKey,
      quantity: item.quantity,
      itemPrice: item.unitSubtotalExGstCents / 100,
    });
  }
  return Object.freeze({
    name: "Purchase",
    eventId: `purchase:${order.orderNumber}`,
    eventTime: Math.floor(now.getTime() / 1_000),
    sourceUrl: "https://rnrgallery.com/orders/confirmation",
    currency: order.currency,
    value: order.totalInclGstCents / 100,
    contentIds: Object.freeze(contentIds),
    contents: Object.freeze(contents),
    ...(measurement.fbp ? { fbp: measurement.fbp } : {}),
    ...(measurement.fbc ? { fbc: measurement.fbc } : {}),
    ...(order.customerEmail.trim()
      ? { hashedEmail: hashMetaEmail(order.customerEmail) }
      : {}),
    ...(order.customerPhone.trim()
      ? { hashedPhone: hashMetaPhone(order.customerPhone) }
      : {}),
  });
}

export function createMetaPurchaseReporter({
  loadPaidOrder,
  send,
  enabled,
  now = () => new Date(),
}: Readonly<{
  loadPaidOrder: (orderNumber: string) => Promise<MetaPaidOrderSnapshot | null>;
  send: (event: SafeMetaEvent) => Promise<MetaSendResult>;
  enabled: () => Promise<boolean>;
  now?: () => Date;
}>) {
  return async function report(orderNumber: string): Promise<MetaSendResult> {
    try {
      if (!await enabled()) return "disabled";
      const order = await loadPaidOrder(orderNumber);
      if (!order) return "disabled";
      const event = buildPurchase(order, now());
      return event ? await send(event) : "disabled";
    } catch {
      return "failed";
    }
  };
}

async function loadPaidOrder(orderNumber: string): Promise<MetaPaidOrderSnapshot | null> {
  const database = getDatabase();
  const [order] = await database.select({
    id: orders.id,
    orderNumber: orders.orderNumber,
    paymentStatus: orders.paymentStatus,
    currency: orders.currency,
    totalInclGstCents: orders.totalInclGstCents,
    customerEmail: orders.customerEmail,
    attribution: orders.attribution,
  }).from(orders).where(eq(orders.orderNumber, orderNumber)).limit(1);
  if (!order) return null;
  const [items, [billing]] = await Promise.all([
    database.select({
      productKey: orderItems.productKey,
      quantity: orderItems.quantity,
      unitSubtotalExGstCents: orderItems.unitSubtotalExGstCents,
    }).from(orderItems).where(eq(orderItems.orderId, order.id)).orderBy(asc(orderItems.position)),
    database.select({ phone: orderAddresses.phone }).from(orderAddresses).where(and(
      eq(orderAddresses.orderId, order.id),
      eq(orderAddresses.kind, "billing"),
    )).limit(1),
  ]);
  if (!billing) return null;
  return Object.freeze({
    orderNumber: order.orderNumber,
    paymentStatus: order.paymentStatus,
    currency: order.currency,
    totalInclGstCents: order.totalInclGstCents,
    customerEmail: order.customerEmail,
    customerPhone: billing.phone,
    attribution: order.attribution,
    items: Object.freeze(items.map((item) => Object.freeze(item))),
  });
}

export async function reportMetaPaidOrder(orderNumber: string): Promise<MetaSendResult> {
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN?.trim();
  const executionFlag = process.env.META_CAPI_EXECUTION_ENABLED;
  const client = createMetaCapiClient({ accessToken, executionFlag });
  return createMetaPurchaseReporter({
    loadPaidOrder,
    send: client.send,
    enabled: async () => executionFlag === "true"
      && Boolean(accessToken)
      && (await getSafePublicContent(["advertising.meta.enabled"]))
        ["advertising.meta.enabled"] === "enabled",
  })(orderNumber);
}

export function createMetaPaidOrderObserver(
  scheduleAfter: (task: () => Promise<void>) => void,
  report: (orderNumber: string) => Promise<unknown> = reportMetaPaidOrder,
) {
  return function onVerifiedPaidOrder(orderNumber: string) {
    scheduleAfter(async () => {
      try {
        await report(orderNumber);
      } catch {
        // The committed payment remains authoritative when measurement fails.
      }
    });
  };
}
