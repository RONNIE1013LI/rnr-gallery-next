import type { CustomerEmailProvider } from "@/server/notifications/customer-notification-service";
import { after } from "next/server";
import { createAutomaticInvoiceEmail, type AutomaticInvoiceTrigger } from "@/server/notifications/automatic-invoice-email";
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getDatabase } from "@/server/db/client";
import { adminAuditLogs, productionJobs, orders } from "@/server/db/schema";
import { buildAuditRecord } from "./audit-service";
import { createDrizzleInvoiceRepository } from "@/server/invoices/drizzle-invoice-repository";
import { createInvoiceService } from "@/server/invoices/invoice-service";
import { getInvoiceBusinessSettings } from "@/server/invoices/invoice-business";
import { createInvoiceEmailService } from "@/server/notifications/invoice-email-service";
import { createResendEmailProvider } from "@/server/notifications/resend-email-provider";
import { getSafePublicContent } from "./admin-content-runtime";
import { orderEmailTemplateKeys } from "@/server/notifications/order-email-templates";
import { customerEmailSignatureKeys } from "@/server/notifications/customer-email-signature";

export function getAdminInvoiceRuntime(database = getDatabase(), provider?: CustomerEmailProvider) {
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
    createEmailService(actor: Readonly<{ userId: string; email: string }>, context: Readonly<{ source: "automatic" | "manual"; trigger: AutomaticInvoiceTrigger | "manual_send" | "manual_resend" }> = { source: "manual", trigger: "manual_send" }) {
      return createInvoiceEmailService({
        provider: provider ?? createResendEmailProvider({ RESEND_API_KEY: process.env.RESEND_API_KEY, EMAIL_FROM: process.env.EMAIL_FROM }),
        createPdf: async (invoice) => (await import("@/server/invoices/invoice-pdf")).createInvoicePdf(invoice as never),
        siteUrl: process.env.BETTER_AUTH_URL ?? "https://rnrgallery.com",
        orderAccessSecret: process.env.BETTER_AUTH_SECRET ?? "",
        loadPublishedTemplates: () => getSafePublicContent(orderEmailTemplateKeys),
        loadPublishedSignature: () => getSafePublicContent(customerEmailSignatureKeys),
        recordAttempt: async (attempt) => {
          await database.insert(adminAuditLogs).values(buildAuditRecord({
            actorUserId: actor.userId, actorEmail: actor.email, action: "invoice.email.sent", resourceType: "invoice", resourceId: attempt.invoiceId,
            result: attempt.result, idempotencyKey: attempt.idempotencyKey,
            afterSummary: { jobId: attempt.jobId ?? null, orderNumber: attempt.orderNumber ?? null, source: context.source, trigger: context.trigger, status: attempt.result, sentAt: attempt.createdAt.toISOString(), recipientEmail: attempt.recipientEmail, providerMessageId: attempt.providerMessageId ?? null, errorCode: attempt.errorCode ?? null, subject: attempt.subject, body: attempt.body },
            requestSource: "admin",
          }));
        },
      });
    },
    async latestEmailAttempt(invoiceId: string) {
      const [row] = await database.select({ result: adminAuditLogs.result, afterSummary: adminAuditLogs.afterSummary, actorEmail: adminAuditLogs.actorEmail, createdAt: adminAuditLogs.createdAt }).from(adminAuditLogs).where(and(eq(adminAuditLogs.resourceType, "invoice"), eq(adminAuditLogs.resourceId, invoiceId), eq(adminAuditLogs.action, "invoice.email.sent"), eq(adminAuditLogs.result, "success"))).orderBy(desc(adminAuditLogs.createdAt)).limit(1);
      return row ?? null;
    },
  });
}


export const automaticInvoiceActor = Object.freeze({ userId: "system:invoice-email", email: "system@rrgallery.co.nz" });

// Called only with IDs returned by this request's NEW formal-order insertion, after commit.
export function scheduleNewOrderInvoiceEmail(jobId: string) {
  try {
    after(() => deliverNewOrderInvoiceEmail(jobId));
  } catch {
    console.error("invoice automatic delivery could not be scheduled", { jobId });
  }
}

export async function deliverNewOrderInvoiceEmail(jobId: string, database = getDatabase(), provider?: CustomerEmailProvider) {
      const runtime = getAdminInvoiceRuntime(database, provider);
      const run = createAutomaticInvoiceEmail({
        load: async (id) => {
          const [job] = await database.select({ source: productionJobs.source, customerEmail: productionJobs.customerEmail, orderEmail: orders.customerEmail, orderNumber: orders.orderNumber }).from(productionJobs).leftJoin(orders, eq(orders.id, productionJobs.orderId)).where(eq(productionJobs.id, id)).limit(1);
          const invoice = await createDrizzleInvoiceRepository(database).findByJobId(id);
          if (!job || !invoice) return null;
          return { invoice: { ...invoice, webOrderNumber: job.source === "web" ? job.orderNumber : null }, customerEmail: job.source === "web" ? job.orderEmail ?? "" : job.customerEmail ?? "", trigger: job.source === "web" ? "website_order_created" : "manual_order_created" };
        },
        claim: async (key, invoiceId, trigger) => {
          const rows = await database.insert(adminAuditLogs).values(buildAuditRecord({ actorUserId: automaticInvoiceActor.userId, actorEmail: automaticInvoiceActor.email, action: "invoice.email.claimed", resourceType: "invoice", resourceId: invoiceId, result: "success", idempotencyKey: key, afterSummary: { source: "automatic", trigger, jobId, status: "claimed" }, requestSource: "system" })).onConflictDoNothing().returning({ id: adminAuditLogs.id });
          return rows.length === 1;
        },
        send: (invoice, trigger, key) => runtime.createEmailService(automaticInvoiceActor, { source: "automatic", trigger }).send(invoice, { idempotencyKey: key }),
        recordSkipped: async (invoice, trigger, key, reason) => {
          await database.insert(adminAuditLogs).values(buildAuditRecord({ actorUserId: automaticInvoiceActor.userId, actorEmail: automaticInvoiceActor.email, action: "invoice.email.skipped", resourceType: "invoice", resourceId: invoice.id, result: "success", idempotencyKey: key, afterSummary: { source: "automatic", trigger, jobId, status: "skipped", reason }, requestSource: "system" })).onConflictDoNothing();
        },
        recordFailure: async (id) => {
          await database.insert(adminAuditLogs).values(buildAuditRecord({ actorUserId: automaticInvoiceActor.userId, actorEmail: automaticInvoiceActor.email, action: "invoice.email.failed", resourceType: "production_job", resourceId: id, result: "failure", idempotencyKey: `invoice-auto-failed:${id}`, afterSummary: { source: "automatic", status: "failure", errorCode: "invoice_or_delivery_unavailable" }, requestSource: "system" })).onConflictDoNothing();
        },
      });
      await run(jobId);
}
