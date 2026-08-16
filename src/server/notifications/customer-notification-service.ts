import type {
  CustomerNotificationKind,
  CustomerNotificationStatus,
} from "@/server/db/schema";
import { signProofAccess } from "@/server/production/proof-access-link";
import {
  defaultCustomerEmailSignatureValues,
  renderCustomerEmailSignature,
  type CustomerEmailSignatureValues,
} from "./customer-email-signature";

export type CustomerNotificationDelivery = Readonly<{
  id: string;
  eventKey: string;
  kind: CustomerNotificationKind;
  jobId: string;
  orderId: string;
  orderNumber: string;
  fileId: string;
  proofVersion: number;
  customerName: string;
  recipientEmail: string;
  status: CustomerNotificationStatus;
  attempts: number;
  createdAt: Date;
}>;

export type CustomerNotificationSummary = Readonly<{
  fileId: string;
  status: CustomerNotificationStatus;
  attempts: number;
  lastErrorCode: string | null;
  sentAt: Date | null;
}>;

export interface CustomerNotificationRepository {
  claimForFile(fileId: string, now: Date): Promise<CustomerNotificationDelivery | null>;
  claimNext(now: Date): Promise<CustomerNotificationDelivery | null>;
  markSent(id: string, providerMessageId: string, now: Date): Promise<boolean>;
  markFailed(id: string, errorCode: string, availableAt: Date, now: Date): Promise<boolean>;
  listForJob(jobId: string): Promise<readonly CustomerNotificationSummary[]>;
}

export type CustomerEmailMessage = Readonly<{
  to: string;
  subject: string;
  text: string;
  html: string;
  proofUrl?: string;
  idempotencyKey: string;
}>;

export interface CustomerEmailProvider {
  configured: boolean;
  send(message: CustomerEmailMessage): Promise<Readonly<{ providerMessageId: string }>>;
}

export class EmailDeliveryError extends Error {
  readonly code: string;

  constructor(code: string) {
    super("Customer email delivery failed");
    this.name = "EmailDeliveryError";
    this.code = /^[a-z0-9_-]{1,80}$/i.test(code) ? code.toLowerCase() : "provider_error";
  }
}

const proofLinkLifetimeMs = 30 * 24 * 60 * 60 * 1000;
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

function proofMessage(
  event: CustomerNotificationDelivery,
  siteUrl: string,
  proofSecret: string,
  signatureValues: Partial<CustomerEmailSignatureValues>,
) {
  const expires = Math.floor((event.createdAt.getTime() + proofLinkLifetimeMs) / 1000);
  const signature = signProofAccess({
    orderNumber: event.orderNumber,
    fileId: event.fileId,
    expires,
  }, proofSecret);
  const proofUrl = new URL(`/orders/${encodeURIComponent(event.orderNumber)}/proof`, siteUrl);
  proofUrl.searchParams.set("file", event.fileId);
  proofUrl.searchParams.set("expires", String(expires));
  proofUrl.searchParams.set("signature", signature);
  const subject = `Your R&R Gallery design draft v${event.proofVersion} is ready`;
  const footer = renderCustomerEmailSignature(signatureValues, siteUrl);
  const text = [
    `Hello ${event.customerName},`,
    "",
    `Your design draft for order ${event.orderNumber} is ready to review.`,
    "Please approve it for production or list all requested changes together.",
    "Up to two revision rounds are included. Changing to a different source photo may cost $25, and further revision rounds may cost $30.",
    "",
    proofUrl.toString(),
    "",
    footer.text,
  ].join("\n");
  const html = `<p>Hello ${escapeHtml(event.customerName)},</p><p>Your design draft for order <strong>${escapeHtml(event.orderNumber)}</strong> is ready to review.</p><p>Please approve it for production or list all requested changes together. Up to two revision rounds are included. Changing to a different source photo may cost $25, and further revision rounds may cost $30.</p><p><a href="${escapeHtml(proofUrl.toString())}">Review your design draft</a></p>${footer.html}`;
  return Object.freeze({
    to: event.recipientEmail,
    subject,
    text,
    html,
    proofUrl: proofUrl.toString(),
    idempotencyKey: event.eventKey,
  });
}

export function createCustomerNotificationService(
  repository: CustomerNotificationRepository,
  dependencies: Readonly<{
    provider: CustomerEmailProvider;
    siteUrl: string;
    proofSecret: string;
    loadPublishedSignature?: () => Promise<Partial<CustomerEmailSignatureValues>>;
    now?: () => Date;
  }>,
) {
  async function loadSignature() {
    return dependencies.loadPublishedSignature
      ? dependencies.loadPublishedSignature().catch(() => defaultCustomerEmailSignatureValues)
      : defaultCustomerEmailSignatureValues;
  }

  async function deliver(
    event: CustomerNotificationDelivery | null,
    signatureValues: Partial<CustomerEmailSignatureValues>,
  ) {
    if (!event) return Object.freeze({ result: "empty" as const });
    const now = dependencies.now?.() ?? new Date();
    const expiresAt = event.createdAt.getTime() + proofLinkLifetimeMs;
    if (expiresAt <= now.getTime()) {
      await repository.markFailed(event.id, "proof_link_expired", new Date(expiresAt), now);
      return Object.freeze({ result: "failed" as const });
    }
    try {
      const sent = await dependencies.provider.send(
        proofMessage(event, dependencies.siteUrl, dependencies.proofSecret, signatureValues),
      );
      await repository.markSent(event.id, sent.providerMessageId, now);
      return Object.freeze({ result: "sent" as const });
    } catch (error) {
      const code = error instanceof EmailDeliveryError ? error.code : "provider_error";
      const delay = retryDelaysMs[Math.min(event.attempts - 1, retryDelaysMs.length - 1)];
      await repository.markFailed(event.id, code, new Date(now.getTime() + delay), now);
      return Object.freeze({ result: "failed" as const });
    }
  }

  return Object.freeze({
    async deliverForFile(fileId: string) {
      if (!dependencies.provider.configured) {
        return Object.freeze({ result: "not_configured" as const });
      }
      return deliver(
        await repository.claimForFile(fileId, dependencies.now?.() ?? new Date()),
        await loadSignature(),
      );
    },

    async deliverPending(limit = 10) {
      if (!dependencies.provider.configured) {
        return Object.freeze({ result: "not_configured" as const, sent: 0, failed: 0 });
      }
      const safeLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
      const signatureValues = await loadSignature();
      let sent = 0;
      let failed = 0;
      for (let index = 0; index < safeLimit; index += 1) {
        const result = await deliver(
          await repository.claimNext(dependencies.now?.() ?? new Date()),
          signatureValues,
        );
        if (result.result === "empty") break;
        if (result.result === "sent") sent += 1;
        if (result.result === "failed") failed += 1;
      }
      return Object.freeze({ result: "processed" as const, sent, failed });
    },

    listForJob: repository.listForJob,
  });
}
