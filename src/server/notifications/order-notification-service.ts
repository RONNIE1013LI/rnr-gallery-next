import type {
  OrderNotificationKind,
  OrderNotificationStatus,
  OrderPaymentStatus,
} from "@/server/db/schema";
import type { MarketCurrency } from "@/domain/markets/types";
import { formatMarketMoney } from "@/domain/money";
import { createOrderEmailAccessToken } from "@/server/orders/order-email-access";
import {
  defaultCustomerEmailSignatureValues,
  renderCustomerEmailSignature,
  type CustomerEmailSignatureValues,
} from "./customer-email-signature";
import {
  defaultOrderEmailTemplateValues,
  renderOrderEmailTemplate,
  type OrderEmailTemplateValues,
} from "./order-email-templates";
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
  paymentStatus: OrderPaymentStatus;
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
  discard(id: string): Promise<boolean>;
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

function orderMessage(
  event: OrderNotificationDelivery,
  siteUrl: string,
  orderAccessSecret: string,
  now: Date,
  templateValues: Partial<OrderEmailTemplateValues>,
  signatureValues: Partial<CustomerEmailSignatureValues>,
): CustomerEmailMessage {
  const orderUrl = new URL(
    event.kind === "admin_order_received"
      ? `/admin/orders/${encodeURIComponent(event.orderId)}`
      : `/orders/${encodeURIComponent(event.orderNumber)}`,
    siteUrl,
  );
  if (event.kind === "payment_confirmed") {
    orderUrl.searchParams.set(
      "access",
      createOrderEmailAccessToken(event.orderNumber, orderAccessSecret, now),
    );
  }
  if (event.kind === "payment_failed") {
    orderUrl.hash = "payment";
  }

  const { subject, paragraphs, actionLabel } = renderOrderEmailTemplate(event.kind, templateValues, {
    customerName: event.customerName,
    orderNumber: event.orderNumber,
    amount: formatMarketMoney(event.totalInclGstCents, event.currency),
    trackingNumber: event.trackingNumber,
    trackingCarrier: event.trackingCarrier,
  });

  const actionUrl = event.kind === "order_shipped" && event.trackingUrl
    ? event.trackingUrl
    : orderUrl.toString();
  const greeting = event.kind === "admin_order_received"
    ? "Hello R&R Gallery team,"
    : `Hello ${event.customerName},`;
  const footer = event.kind === "admin_order_received"
    ? Object.freeze({ text: "R&R Gallery", html: "<p>R&amp;R Gallery</p>" })
    : renderCustomerEmailSignature(signatureValues, siteUrl);
  return Object.freeze({
    to: event.recipientEmail,
    subject,
    text: [greeting, "", ...paragraphs, "", `${actionLabel}: ${actionUrl}`, "", footer.text].join("\n"),
    html: `<p>${escapeHtml(greeting)}</p>${paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}<p><a href="${escapeHtml(actionUrl)}">${escapeHtml(actionLabel)}</a></p>${footer.html}`,
    idempotencyKey: event.eventKey,
  });
}

export function createOrderNotificationService(
  repository: OrderNotificationRepository,
  dependencies: Readonly<{
    provider: CustomerEmailProvider;
    siteUrl: string;
    orderAccessSecret: string;
    loadPublishedTemplates?: () => Promise<Partial<OrderEmailTemplateValues>>;
    loadPublishedSignature?: () => Promise<Partial<CustomerEmailSignatureValues>>;
    now?: () => Date;
  }>,
) {
  async function deliver(
    event: OrderNotificationDelivery | null,
    templateValues: Partial<OrderEmailTemplateValues>,
    signatureValues: Partial<CustomerEmailSignatureValues>,
  ) {
    if (!event) return "empty" as const;
    if (event.kind === "payment_failed" && event.paymentStatus !== "failed") {
      await repository.discard(event.id);
      return "discarded" as const;
    }
    const now = dependencies.now?.() ?? new Date();
    try {
      const sent = await dependencies.provider.send(orderMessage(
        event,
        dependencies.siteUrl,
        dependencies.orderAccessSecret,
        now,
        templateValues,
        signatureValues,
      ));
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
      const templateValues = dependencies.loadPublishedTemplates
        ? await dependencies.loadPublishedTemplates().catch(() => defaultOrderEmailTemplateValues)
        : defaultOrderEmailTemplateValues;
      const signatureValues = dependencies.loadPublishedSignature
        ? await dependencies.loadPublishedSignature().catch(() => defaultCustomerEmailSignatureValues)
        : defaultCustomerEmailSignatureValues;
      let sent = 0;
      let failed = 0;
      for (let index = 0; index < safeLimit; index += 1) {
        const result = await deliver(
          await repository.claimNext(dependencies.now?.() ?? new Date()),
          templateValues,
          signatureValues,
        );
        if (result === "empty") break;
        if (result === "sent") sent += 1;
        if (result === "failed") failed += 1;
      }
      return Object.freeze({ result: "processed" as const, sent, failed });
    },
  });
}
