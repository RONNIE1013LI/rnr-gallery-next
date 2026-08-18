import type { MarketCurrency } from "@/domain/markets/types";
import { formatMarketMoney } from "@/domain/money";
import type { PaymentRequestNotificationStatus } from "@/server/db/schema";
import {
  defaultCustomerEmailSignatureValues,
  renderCustomerEmailSignature,
  type CustomerEmailSignatureValues,
} from "./customer-email-signature";
import {
  EmailDeliveryError,
  type CustomerEmailMessage,
  type CustomerEmailProvider,
} from "./customer-notification-service";

export type PaymentRequestNotificationKind =
  | "payment_request_confirmed"
  | "admin_payment_request_received";

export type PaymentRequestNotificationDelivery = Readonly<{
  id: string;
  eventKey: string;
  kind: PaymentRequestNotificationKind;
  paymentRequestId: string;
  requestNumber: string;
  description: string;
  recipientName: string;
  recipientEmail: string;
  currency: MarketCurrency;
  amountCents: number;
  status: PaymentRequestNotificationStatus;
  attempts: number;
  createdAt: Date;
}>;

export interface PaymentRequestNotificationRepository {
  claimNext(now: Date): Promise<PaymentRequestNotificationDelivery | null>;
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

function message(
  event: PaymentRequestNotificationDelivery,
  siteUrl: string,
  signatureValues: Partial<CustomerEmailSignatureValues>,
): CustomerEmailMessage {
  const amount = formatMarketMoney(event.amountCents, event.currency);
  if (event.kind === "admin_payment_request_received") {
    const adminUrl = new URL(
      `/admin/payment-requests/${encodeURIComponent(event.paymentRequestId)}`,
      siteUrl,
    ).toString();
    const text = [
      "Hello R&R Gallery team,",
      "",
      `Payment received: ${amount}`,
      `Payment Request: ${event.requestNumber}`,
      `Description: ${event.description}`,
      "",
      `View payment: ${adminUrl}`,
      "",
      "R&R Gallery",
    ].join("\n");
    return Object.freeze({
      to: event.recipientEmail,
      subject: `Payment received — ${event.requestNumber}`,
      text,
      html: `<p>Hello R&amp;R Gallery team,</p><p>Payment received: <strong>${escapeHtml(amount)}</strong></p><p>Payment Request: ${escapeHtml(event.requestNumber)}<br>Description: ${escapeHtml(event.description)}</p><p><a href="${escapeHtml(adminUrl)}">View payment</a></p><p>R&amp;R Gallery</p>`,
      idempotencyKey: event.eventKey,
    });
  }

  const signature = renderCustomerEmailSignature(signatureValues, siteUrl);
  const greeting = `Hello ${event.recipientName || "there"},`;
  const text = [
    greeting,
    "",
    `We have confirmed your payment of ${amount}.`,
    `Payment reference: ${event.requestNumber}`,
    `Description: ${event.description}`,
    "",
    signature.text,
  ].join("\n");
  return Object.freeze({
    to: event.recipientEmail,
    subject: `Payment confirmed — ${event.requestNumber}`,
    text,
    html: `<p>${escapeHtml(greeting)}</p><p>We have confirmed your payment of <strong>${escapeHtml(amount)}</strong>.</p><p>Payment reference: ${escapeHtml(event.requestNumber)}<br>Description: ${escapeHtml(event.description)}</p>${signature.html}`,
    idempotencyKey: event.eventKey,
  });
}

export function createPaymentRequestNotificationService(
  repository: PaymentRequestNotificationRepository,
  dependencies: Readonly<{
    provider: CustomerEmailProvider;
    siteUrl: string;
    loadPublishedSignature?: () => Promise<Partial<CustomerEmailSignatureValues>>;
    now?: () => Date;
  }>,
) {
  return Object.freeze({
    async deliverPending(limit = 10) {
      if (!dependencies.provider.configured) {
        return Object.freeze({ result: "not_configured" as const, sent: 0, failed: 0 });
      }
      const safeLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
      const signatureValues = dependencies.loadPublishedSignature
        ? await dependencies.loadPublishedSignature().catch(() => defaultCustomerEmailSignatureValues)
        : defaultCustomerEmailSignatureValues;
      let sent = 0;
      let failed = 0;
      for (let index = 0; index < safeLimit; index += 1) {
        const event = await repository.claimNext(dependencies.now?.() ?? new Date());
        if (!event) break;
        const now = dependencies.now?.() ?? new Date();
        try {
          const result = await dependencies.provider.send(
            message(event, dependencies.siteUrl, signatureValues),
          );
          await repository.markSent(event.id, result.providerMessageId, now);
          sent += 1;
        } catch (error) {
          const code = error instanceof EmailDeliveryError ? error.code : "provider_error";
          const delay = retryDelaysMs[Math.min(event.attempts - 1, retryDelaysMs.length - 1)];
          await repository.markFailed(event.id, code, new Date(now.getTime() + delay), now);
          failed += 1;
        }
      }
      return Object.freeze({ result: "processed" as const, sent, failed });
    },
  });
}
