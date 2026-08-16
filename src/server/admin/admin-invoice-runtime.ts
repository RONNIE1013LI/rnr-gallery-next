import { randomUUID } from "node:crypto";
import { getDatabase } from "@/server/db/client";
import { adminAuditLogs } from "@/server/db/schema";
import { buildAuditRecord } from "./audit-service";
import { createDrizzleInvoiceRepository } from "@/server/invoices/drizzle-invoice-repository";
import { createInvoiceService } from "@/server/invoices/invoice-service";
import { getInvoiceBusinessSettings } from "@/server/invoices/invoice-business";

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
  });
}
