import { formatMarketMoney } from "@/domain/money";
import { createOrderEmailAccessToken } from "@/server/orders/order-email-access";
import { renderCustomerEmailSignature, defaultCustomerEmailSignatureValues, type CustomerEmailSignatureValues } from "./customer-email-signature";
import { defaultOrderEmailTemplateValues, renderOrderEmailTemplate, type OrderEmailTemplateValues } from "./order-email-templates";
import { EmailDeliveryError, type CustomerEmailMessage, type CustomerEmailProvider } from "./customer-notification-service";

export type InvoiceLike = Readonly<{ id: string; orderNumber?: string; jobId?: string; invoiceNumber: string; invoiceDate: string; dueDate: string; webOrderNumber: string | null; customerName: string; customerEmail: string; businessName: string; currency: Parameters<typeof formatMarketMoney>[1]; totalInclGstCents: number; amountPaidCents?: number | null }>;
export type InvoiceEmailAttempt = Readonly<{ invoiceId: string; jobId?: string; orderNumber?: string; recipientEmail: string; idempotencyKey: string; result: "success" | "failure"; providerMessageId?: string; errorCode?: string; subject: string; body: string; createdAt: Date }>;

function escapeHtml(value: string) { return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)); }
function safeEmail(value: string) { const email = value.trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) throw new Error("Enter a valid recipient email."); return email; }
function safeFilename(value: string) { return `${value.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 100) || "invoice"}.pdf`; }

export function createInvoiceEmailService(dependencies: Readonly<{ provider: CustomerEmailProvider; createPdf: (invoice: InvoiceLike) => Promise<Uint8Array>; siteUrl: string; orderAccessSecret: string; loadPublishedTemplates?: () => Promise<Partial<OrderEmailTemplateValues>>; loadPublishedSignature?: () => Promise<Partial<CustomerEmailSignatureValues>>; recordAttempt: (attempt: InvoiceEmailAttempt) => Promise<void>; now?: () => Date }>) {
  return Object.freeze({
    async send(invoice: InvoiceLike, input: Readonly<{ recipientEmail?: string; subject?: string; body?: string; idempotencyKey: string }>) {
      let recipientEmail = input.recipientEmail || invoice.customerEmail;
      let subject = "";
      let body = "";
      let stage = "recipient_error";
      if (!/^[\w:-]{8,255}$/.test(input.idempotencyKey)) throw new Error("Invalid idempotency key.");
      const now = dependencies.now?.() ?? new Date();
      try {
        recipientEmail = safeEmail(recipientEmail);
        stage = "template_error";
        const templates = dependencies.loadPublishedTemplates ? await dependencies.loadPublishedTemplates() : defaultOrderEmailTemplateValues;
        const signatureValues = dependencies.loadPublishedSignature ? await dependencies.loadPublishedSignature() : defaultCustomerEmailSignatureValues;
        const orderNumber = invoice.webOrderNumber?.trim();
        const invoiceUrl = orderNumber && !["null", "undefined"].includes(orderNumber) ? new URL(`/orders/${encodeURIComponent(orderNumber)}`, dependencies.siteUrl) : null;
        if (invoiceUrl) invoiceUrl.searchParams.set("access", createOrderEmailAccessToken(orderNumber!, dependencies.orderAccessSecret, now));
        const paid = Math.max(0, invoice.amountPaidCents ?? 0);
        const balance = Math.max(0, invoice.totalInclGstCents - paid);
        const rendered = renderOrderEmailTemplate("invoice_sent", templates, { customerName: invoice.customerName, customerEmail: recipientEmail, orderNumber: invoice.orderNumber || orderNumber || invoice.invoiceNumber, amount: formatMarketMoney(invoice.totalInclGstCents, invoice.currency), trackingNumber: null, trackingCarrier: null, invoiceNumber: invoice.invoiceNumber, invoiceDate: invoice.invoiceDate, dueDate: invoice.dueDate, amountPaid: formatMarketMoney(paid, invoice.currency), balanceDue: formatMarketMoney(balance, invoice.currency), invoiceUrl: invoiceUrl?.toString() ?? "", businessName: invoice.businessName });
        subject = input.subject?.trim() || rendered.subject;
        body = input.body?.trim() || rendered.paragraphs.join("\n\n");
        const footer = renderCustomerEmailSignature(signatureValues, dependencies.siteUrl);
        if (!subject || !body || /[\r\n]/.test(subject)) throw new Error("Invalid invoice template");
        stage = "pdf_error";
        const pdf = await dependencies.createPdf(invoice);
        if (!pdf.byteLength || Buffer.from(pdf).subarray(0, 5).toString() !== "%PDF-") throw new Error("Invalid invoice PDF");
        const message: CustomerEmailMessage = { to: recipientEmail, subject, text: `${body}${invoiceUrl ? `\n\n${rendered.actionLabel}: ${invoiceUrl}` : ""}\n\n${footer.text}`, html: `${body.split(/\n\s*\n/).map((p) => `<p>${escapeHtml(p)}</p>`).join("")}${invoiceUrl ? `<p><a href="${escapeHtml(invoiceUrl.toString())}">${escapeHtml(rendered.actionLabel)}</a></p>` : ""}${footer.html}`, idempotencyKey: input.idempotencyKey, attachments: [{ filename: safeFilename(invoice.invoiceNumber), content: Buffer.from(pdf).toString("base64") }] };
        stage = "provider_error";
        if (!dependencies.provider.configured) throw new EmailDeliveryError("not_configured");
        const sent = await dependencies.provider.send(message);
        await dependencies.recordAttempt({ invoiceId: invoice.id, jobId: invoice.jobId, orderNumber: invoice.orderNumber, recipientEmail, idempotencyKey: input.idempotencyKey, result: "success", providerMessageId: sent.providerMessageId, subject, body, createdAt: now });
        return Object.freeze({ result: "sent" as const, providerMessageId: sent.providerMessageId });
      } catch (error) {
        const errorCode = error instanceof EmailDeliveryError ? error.code : stage;
        await dependencies.recordAttempt({ invoiceId: invoice.id, jobId: invoice.jobId, orderNumber: invoice.orderNumber, recipientEmail, idempotencyKey: input.idempotencyKey, result: "failure", errorCode, subject, body, createdAt: now });
        return Object.freeze({ result: "failed" as const, errorCode });
      }
    },
  });
}
