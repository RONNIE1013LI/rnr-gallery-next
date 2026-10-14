import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { StoredOrderAttribution } from "@/domain/analytics/attribution";
import type { MarketCurrency } from "@/domain/markets/types";
import {
  createOpenAICapiClient, isValidOpenAIClickReference,
  type OpenAISendResult, type SafeOpenAIPurchaseEvent,
} from "@/server/analytics/openai-capi-client";
import { getDatabase } from "@/server/db/client";
import { orders, paymentAttempts, paymentLedgerEntries, type OrderPaymentStatus } from "@/server/db/schema";

export type OpenAIPaidOrderSnapshot = Readonly<{
  orderId: string;
  paymentStatus: OrderPaymentStatus;
  currency: MarketCurrency;
  totalInclGstCents: number;
  paidAt: Date | null;
  attribution: StoredOrderAttribution | null;
}>;

function buildPurchase(order: OpenAIPaidOrderSnapshot, now: Date): SafeOpenAIPurchaseEvent | null {
  const paidTime = order.paidAt?.getTime();
  const measurement = order.attribution?.measurement;
  const consentTime = typeof measurement?.decidedAt === "string" ? Date.parse(measurement.decidedAt) : Number.NaN;
  const oppref = order.attribution?.oppref;
  if (order.paymentStatus !== "paid"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(order.orderId)
    || measurement?.version !== 1 || measurement.advertisingConsent !== true
    || !Number.isFinite(consentTime)
    || new Date(consentTime).toISOString() !== measurement.decidedAt
    || !isValidOpenAIClickReference(oppref)
    || (order.currency !== "NZD" && order.currency !== "AUD")
    || !Number.isSafeInteger(order.totalInclGstCents) || order.totalInclGstCents < 0
    || !Number.isSafeInteger(paidTime) || paidTime! <= 0
    || !Number.isSafeInteger(now.getTime())
    || paidTime! < now.getTime() - 7 * 86_400_000 || paidTime! > now.getTime() + 10 * 60_000
    || consentTime > paidTime!) return null;
  const history = order.attribution?.touches;
  const validCaptureTime = (value: unknown) => {
    const capturedTime = typeof value === "string" ? Date.parse(value) : Number.NaN;
    return Number.isFinite(capturedTime) && new Date(capturedTime).toISOString() === value
      && capturedTime <= paidTime! && paidTime! - capturedTime <= 30 * 86_400_000;
  };
  const capturedAt = measurement.opprefCapturedAt;
  const capturedClick = capturedAt !== undefined
    ? validCaptureTime(capturedAt)
    : history?.version === 1
      && [history.firstTouch, history.lastNonDirectTouch, history.lastTouch].some((touch) =>
        touch?.campaign?.oppref === oppref && validCaptureTime(touch.at));
  if (!capturedClick) return null;
  return Object.freeze({
    id: `purchase_${createHash("sha256").update(order.orderId, "utf8").digest("hex")}`,
    type: "order_created",
    timestamp_ms: paidTime!,
    oppref,
    source_url: "https://rnrgallery.com/",
    action_source: "web",
    opt_out: true,
    data: Object.freeze({ type: "contents", amount: order.totalInclGstCents, currency: order.currency }),
  });
}

export function createOpenAIPurchaseReporter({
  loadPaidOrder, send, enabled, now = () => new Date(),
}: Readonly<{
  loadPaidOrder: (orderNumber: string) => Promise<OpenAIPaidOrderSnapshot | null>;
  send: (event: SafeOpenAIPurchaseEvent) => Promise<OpenAISendResult>;
  enabled: () => boolean;
  now?: () => Date;
}>) {
  return async function report(orderNumber: string): Promise<OpenAISendResult> {
    try {
      if (!enabled()) return "disabled";
      const order = await loadPaidOrder(orderNumber);
      if (!order) return "disabled";
      const event = buildPurchase(order, now());
      return event ? await send(event) : "disabled";
    } catch {
      return "failed";
    }
  };
}

async function loadPaidOrder(orderNumber: string): Promise<OpenAIPaidOrderSnapshot | null> {
  const database = getDatabase();
  const [order] = await database.select({
    orderId: orders.id,
    paymentStatus: orders.paymentStatus,
    currency: orders.currency,
    totalInclGstCents: orders.totalInclGstCents,
    attribution: orders.attribution,
  }).from(orders).where(and(eq(orders.paymentStatus, "paid"), or(
    eq(orders.orderNumber, orderNumber), eq(orders.paymentReference, orderNumber),
  ))).limit(1);
  if (!order) return null;
  // Immutable receipt time survives webhook replay and fulfilment updates.
  const [receipt] = await database.select({ paidAt: paymentLedgerEntries.receivedAt })
    .from(paymentLedgerEntries)
    .innerJoin(paymentAttempts, eq(paymentLedgerEntries.paymentAttemptId, paymentAttempts.id))
    .where(and(
      eq(paymentLedgerEntries.orderId, order.orderId),
      isNull(paymentLedgerEntries.paymentRequestId),
      eq(paymentLedgerEntries.entryType, "online_payment"),
      eq(paymentLedgerEntries.direction, "credit"),
      eq(paymentLedgerEntries.amountCents, order.totalInclGstCents),
      eq(paymentLedgerEntries.currency, order.currency),
      eq(paymentAttempts.orderId, order.orderId),
      isNull(paymentAttempts.paymentRequestId),
      eq(paymentAttempts.status, "paid"),
      inArray(paymentAttempts.provider, ["stripe", "afterpay", "flik"]),
      eq(paymentAttempts.expectedAmountCents, order.totalInclGstCents),
      eq(paymentAttempts.currency, order.currency),
      sql`${paymentLedgerEntries.idempotencyKey} = 'direct-payment-receipt:' || ${paymentAttempts.id}::text`,
    )).orderBy(asc(paymentLedgerEntries.receivedAt), asc(paymentLedgerEntries.id)).limit(1);
  return receipt ? Object.freeze({ ...order, paidAt: receipt.paidAt }) : null;
}

export async function reportOpenAIPaidOrder(orderNumber: string): Promise<OpenAISendResult> {
  const client = createOpenAICapiClient({
    pixelId: process.env.OPENAI_ADS_PIXEL_ID,
    apiKey: process.env.OPENAI_ADS_CONVERSIONS_API_KEY,
    executionFlag: process.env.OPENAI_ADS_CONVERSIONS_ENABLED,
    environment: process.env.VERCEL_ENV,
  });
  return createOpenAIPurchaseReporter({ loadPaidOrder, send: client.send, enabled: () => client.enabled })(orderNumber);
}

export function createOpenAIPaidOrderObserver(
  scheduleAfter: (task: () => Promise<void>) => void,
  report: (orderNumber: string) => Promise<unknown> = reportOpenAIPaidOrder,
) {
  return function onVerifiedPaidOrder(orderNumber: string) {
    try {
      scheduleAfter(async () => {
        try {
          if (await report(orderNumber) === "failed") console.warn("OpenAI conversion reporting failed");
        } catch {
          // Measurement failure must never reverse the authoritative committed payment.
        }
      });
    } catch {
      // Scheduling failure must never interrupt the authoritative payment response.
    }
  };
}
