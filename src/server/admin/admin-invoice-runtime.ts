import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getDatabase } from "@/server/db/client";
import { adminAuditLogs } from "@/server/db/schema";
import { buildAuditRecord } from "./audit-service";
import { createDrizzleInvoiceRepository } from "@/server/invoices/drizzle-invoice-repository";
import { createInvoiceService } from "@/server/invoices/invoice-service";
import { getInvoiceBusinessSettings } from "@/server/invoices/invoice-business";
import { createInvoiceEmailService } from "@/server/notifications/invoice-email-service";
import { createResendEmailProvider } from "@/server/notifications/resend-email-provider";
import { getSafePublicContent } from "./admin-content-runtime";
import { orderEmailTemplateKeys } from "@/server/notifications/order-email-templates";
import { customerEmailSignatureKeys } from "@/server/notifications/customer-email-signature";

export function getAdminInvoiceRuntime() {
  const database = getDatabase();
  const service = createInvoiceService(
    createDrizzleInvoiceRepository(database),
    { business: getInvoiceBusinessSettings() },
  );
  return Object.freeze({
    ...service,
    async recordDownload(input: Readonly<{
      actor: Readonly<{ userId: string; email: string }>;
      invoiceId: string;
      invoiceNumber: string;
      requestSource: string;
    }>) {
      await database.insert(adminAuditLogs).values(buildAuditRecord({
        actorUserId: input.actor.userId,
        actorEmail: input.actor.email,
        action: "invoice.downloaded",
        resourceType: "invoice",
        resourceId: input.invoiceId,
        afterSummary: { invoiceNumber: input.invoiceNumber },
        requestSource: input.requestSource,
        result: "success",
        idempotencyKey: `invoice-download:${randomUUID()}`,
      }));
    },
    createEmailService(actor: Readonly<{ userId: string; email: string }>) {
      return createInvoiceEmailService({
        provider: createResendEmailProvider({ RESEND_API_KEY: process.env.RESEND_API_KEY, EMAIL_FROM: process.env.EMAIL_FROM }),
        createPdf: async (invoice) => (await import("@/server/invoices/invoice-pdf")).createInvoicePdf(invoice as never),
        siteUrl: process.env.BETTER_AUTH_URL ?? "https://rnrgallery.com",
        orderAccessSecret: process.env.BETTER_AUTH_SECRET ?? "",
        loadPublishedTemplates: () => getSafePublicContent(orderEmailTemplateKeys),
        loadPublishedSignature: () => getSafePublicContent(customerEmailSignatureKeys),
        recordAttempt: async (attempt) => {
          await database.insert(adminAuditLogs).values(buildAuditRecord({
            actorUserId: actor.userId, actorEmail: actor.email, action: "invoice.email.sent", resourceType: "invoice", resourceId: attempt.invoiceId,
            result: attempt.result, idempotencyKey: attempt.idempotencyKey,
            afterSummary: { recipientEmail: attempt.recipientEmail, providerMessageId: attempt.providerMessageId ?? null, errorCode: attempt.errorCode ?? null, subject: attempt.subject, body: attempt.body },
            requestSource: "admin",
          }));
        },
      });
    },
    async latestEmailAttempt(invoiceId: string) {
      const [row] = await database.select({ result: adminAuditLogs.result, afterSummary: adminAuditLogs.afterSummary, createdAt: adminAuditLogs.createdAt }).from(adminAuditLogs).where(and(eq(adminAuditLogs.resourceType, "invoice"), eq(adminAuditLogs.resourceId, invoiceId), eq(adminAuditLogs.action, "invoice.email.sent"))).orderBy(desc(adminAuditLogs.createdAt)).limit(1);
      return row ?? null;
    },
  });
}
