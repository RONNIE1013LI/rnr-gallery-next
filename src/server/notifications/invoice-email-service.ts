import { formatMarketMoney } from "@/domain/money";
import { createOrderEmailAccessToken } from "@/server/orders/order-email-access";
import { renderCustomerEmailSignature, defaultCustomerEmailSignatureValues, type CustomerEmailSignatureValues } from "./customer-email-signature";
import { defaultOrderEmailTemplateValues, renderOrderEmailTemplate, type OrderEmailTemplateValues } from "./order-email-templates";
import { EmailDeliveryError, type CustomerEmailMessage, type CustomerEmailProvider } from "./customer-notification-service";

export type InvoiceLike = Readonly<{ id: string; invoiceNumber: string; invoiceDate: string; dueDate: string; webOrderNumber: string; customerName: string; customerEmail: string; businessName: string; currency: Parameters<typeof formatMarketMoney>[1]; totalInclGstCents: number; amountPaidCents?: number | null }>;
type Attempt = Readonly<{ invoiceId: string; recipientEmail: string; idempotencyKey: string; result: "success" | "failure"; providerMessageId?: string; errorCode?: string; subject: string; body: string; createdAt: Date }>;

function escapeHtml(value: string) { return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)); }
function safeEmail(value: string) { const email = value.trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) throw new Error("Enter a valid recipient email."); return email; }
function safeFilename(value: string) { return `${value.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 100) || "invoice"}.pdf`; }

export function createInvoiceEmailService(dependencies: Readonly<{ provider: CustomerEmailProvider; createPdf: (invoice: InvoiceLike) => Promise<Uint8Array>; siteUrl: string; orderAccessSecret: string; loadPublishedTemplates?: () => Promise<Partial<OrderEmailTemplateValues>>; loadPublishedSignature?: () => Promise<Partial<CustomerEmailSignatureValues>>; recordAttempt: (attempt: Attempt) => Promise<void>; now?: () => Date }>) {
  return Object.freeze({
    async send(invoice: InvoiceLike, input: Readonly<{ recipientEmail?: string; subject?: string; body?: string; idempotencyKey: string }>) {
      const recipientEmail = safeEmail(input.recipientEmail || invoice.customerEmail);
      if (!/^[\w:-]{8,255}$/.test(input.idempotencyKey)) throw new Error("Invalid idempotency key.");
      const now = dependencies.now?.() ?? new Date();
      const templates = dependencies.loadPublishedTemplates ? await dependencies.loadPublishedTemplates().catch(() => defaultOrderEmailTemplateValues) : defaultOrderEmailTemplateValues;
      const signatureValues = dependencies.loadPublishedSignature ? await dependencies.loadPublishedSignature().catch(() => defaultCustomerEmailSignatureValues) : defaultCustomerEmailSignatureValues;
      const invoiceUrl = new URL(`/orders/${encodeURIComponent(invoice.webOrderNumber)}`, dependencies.siteUrl);
      invoiceUrl.searchParams.set("access", createOrderEmailAccessToken(invoice.webOrderNumber, dependencies.orderAccessSecret, now));
      const paid = Math.max(0, invoice.amountPaidCents ?? 0);
      const balance = Math.max(0, invoice.totalInclGstCents - paid);
      const rendered = renderOrderEmailTemplate("invoice_sent", templates, { customerName: invoice.customerName, customerEmail: recipientEmail, orderNumber: invoice.webOrderNumber, amount: formatMarketMoney(invoice.totalInclGstCents, invoice.currency), trackingNumber: null, trackingCarrier: null, invoiceNumber: invoice.invoiceNumber, invoiceDate: invoice.invoiceDate, dueDate: invoice.dueDate, amountPaid: formatMarketMoney(paid, invoice.currency), balanceDue: formatMarketMoney(balance, invoice.currency), invoiceUrl: invoiceUrl.toString(), businessName: invoice.businessName });
      const subject = input.subject?.trim() || rendered.subject;
      const body = input.body?.trim() || rendered.paragraphs.join("\n\n");
      const footer = renderCustomerEmailSignature(signatureValues, dependencies.siteUrl);
      const message: CustomerEmailMessage = { to: recipientEmail, subject, text: `${body}\n\n${rendered.actionLabel}: ${invoiceUrl}\n\n${footer.text}`, html: `${body.split(/\n\s*\n/).map((p) => `<p>${escapeHtml(p)}</p>`).join("")}<p><a href="${escapeHtml(invoiceUrl.toString())}">${escapeHtml(rendered.actionLabel)}</a></p>${footer.html}`, idempotencyKey: input.idempotencyKey, attachments: [{ filename: safeFilename(invoice.invoiceNumber), content: Buffer.from(await dependencies.createPdf(invoice)).toString("base64") }] };
      try {
        if (!dependencies.provider.configured) throw new EmailDeliveryError("not_configured");
        const sent = await dependencies.provider.send(message);
        await dependencies.recordAttempt({ invoiceId: invoice.id, recipientEmail, idempotencyKey: input.idempotencyKey, result: "success", providerMessageId: sent.providerMessageId, subject, body, createdAt: now });
        return Object.freeze({ result: "sent" as const, providerMessageId: sent.providerMessageId });
      } catch (error) {
        const errorCode = error instanceof EmailDeliveryError ? error.code : "provider_error";
        await dependencies.recordAttempt({ invoiceId: invoice.id, recipientEmail, idempotencyKey: input.idempotencyKey, result: "failure", errorCode, subject, body, createdAt: now });
        return Object.freeze({ result: "failed" as const, errorCode });
      }
    },
  });
}
