import { randomUUID } from "node:crypto";
import { getDatabase } from "@/server/db/client";
import { adminAuditLogs } from "@/server/db/schema";
import { buildAuditRecord } from "./audit-service";
import { createDrizzleInvoiceRepository } from "@/server/invoices/drizzle-invoice-repository";
import { createInvoiceService } from "@/server/invoices/invoice-service";

function invoiceBusiness() {
  return Object.freeze({
    name: process.env.INVOICE_BUSINESS_NAME?.trim() || "R&R Gallery",
    address: process.env.INVOICE_BUSINESS_ADDRESS?.trim() || "11 Para Close\nFairview Heights\nAuckland 0632\nNew Zealand",
    email: process.env.INVOICE_BUSINESS_EMAIL?.trim() || "customerservice@rnrgallery.com",
    phone: process.env.INVOICE_BUSINESS_PHONE?.trim() || "+64 21 023 48948",
    website: process.env.INVOICE_BUSINESS_WEBSITE?.trim() || "https://rnrgallery.com/",
    gstNumber: process.env.INVOICE_GST_NUMBER?.trim() || "125-796-389",
    bankAccount: process.env.INVOICE_BANK_ACCOUNT?.trim() || "04-2021-0317735-07",
  });
}

export function getAdminInvoiceRuntime() {
  const database = getDatabase();
  const service = createInvoiceService(
    createDrizzleInvoiceRepository(database),
    { business: invoiceBusiness() },
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
  });
}
