import type {
  OrderNotificationKind,
  OrderNotificationStatus,
} from "@/server/db/schema";
import type { MarketCurrency } from "@/domain/markets/types";
import { formatMarketMoney } from "@/domain/money";
import {
  EmailDeliveryError,
  type CustomerEmailMessage,
  type CustomerEmailProvider,
} from "./customer-notification-service";

export type OrderNotificationDelivery = Readonly<{
  id: string;
  eventKey: string;
  kind: OrderNotificationKind;
  orderId: string;
  orderNumber: string;
  customerName: string;
  recipientEmail: string;
  currency: MarketCurrency;
  totalInclGstCents: number;
  trackingNumber: string | null;
  trackingCarrier: string | null;
  trackingUrl: string | null;
  status: OrderNotificationStatus;
  attempts: number;
  createdAt: Date;
}>;

export interface OrderNotificationRepository {
  claimNext(now: Date): Promise<OrderNotificationDelivery | null>;
  markSent(id: string, providerMessageId: string, now: Date): Promise<boolean>;
  markFailed(id: string, errorCode: string, availableAt: Date, now: Date): Promise<boolean>;
}

const retryDelaysMs = [5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 12 * 60 * 60_000, 24 * 60 * 60_000] as const;

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

function orderMessage(event: OrderNotificationDelivery, siteUrl: string): CustomerEmailMessage {
  const orderUrl = new URL(`/orders/${encodeURIComponent(event.orderNumber)}`, siteUrl);
  let subject: string;
  let paragraphs: readonly string[];

  if (event.kind === "payment_confirmed") {
    subject = `Payment confirmed — ${event.orderNumber}`;
    paragraphs = [
      `We have confirmed your payment of ${formatMarketMoney(event.totalInclGstCents, event.currency)} for order ${event.orderNumber}.`,
      "Production normally takes 5 business days from the order date. We will contact you if your artwork requires a design review.",
    ];
  } else if (event.kind === "payment_failed") {
    subject = `Payment could not be completed — ${event.orderNumber}`;
    orderUrl.hash = "payment";
    paragraphs = [
      `Payment for order ${event.orderNumber} was not completed, so production has not started.`,
      "You can return to your order and try payment again.",
    ];
  } else {
    subject = `Your order has been shipped — ${event.orderNumber}`;
    const tracking = event.trackingNumber && event.trackingCarrier
      ? `Tracking: ${event.trackingCarrier} ${event.trackingNumber}.`
      : "Your order is on its way.";
    paragraphs = [tracking];
  }

  const actionUrl = event.kind === "order_shipped" && event.trackingUrl
    ? event.trackingUrl
    : orderUrl.toString();
  const actionLabel = event.kind === "payment_failed"
    ? "Retry payment"
    : event.kind === "order_shipped"
      ? "Track your order"
      : "View your order";
  const greeting = `Hello ${event.customerName},`;
  return Object.freeze({
    to: event.recipientEmail,
    subject,
    text: [greeting, "", ...paragraphs, "", `${actionLabel}: ${actionUrl}`, "", "R&R Gallery"].join("\n"),
    html: `<p>${escapeHtml(greeting)}</p>${paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}<p><a href="${escapeHtml(actionUrl)}">${escapeHtml(actionLabel)}</a></p><p>R&amp;R Gallery</p>`,
    idempotencyKey: event.eventKey,
  });
}

export function createOrderNotificationService(
  repository: OrderNotificationRepository,
  dependencies: Readonly<{
    provider: CustomerEmailProvider;
    siteUrl: string;
    now?: () => Date;
  }>,
) {
  async function deliver(event: OrderNotificationDelivery | null) {
    if (!event) return "empty" as const;
    const now = dependencies.now?.() ?? new Date();
    try {
      const sent = await dependencies.provider.send(orderMessage(event, dependencies.siteUrl));
      await repository.markSent(event.id, sent.providerMessageId, now);
      return "sent" as const;
    } catch (error) {
      const code = error instanceof EmailDeliveryError ? error.code : "provider_error";
      const delay = retryDelaysMs[Math.min(event.attempts - 1, retryDelaysMs.length - 1)];
      await repository.markFailed(event.id, code, new Date(now.getTime() + delay), now);
      return "failed" as const;
    }
  }

  return Object.freeze({
    async deliverPending(limit = 10) {
      if (!dependencies.provider.configured) {
        return Object.freeze({ result: "not_configured" as const, sent: 0, failed: 0 });
      }
      const safeLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
      let sent = 0;
      let failed = 0;
      for (let index = 0; index < safeLimit; index += 1) {
        const result = await deliver(await repository.claimNext(dependencies.now?.() ?? new Date()));
        if (result === "empty") break;
        if (result === "sent") sent += 1;
        if (result === "failed") failed += 1;
      }
      return Object.freeze({ result: "processed" as const, sent, failed });
    },
  });
}
