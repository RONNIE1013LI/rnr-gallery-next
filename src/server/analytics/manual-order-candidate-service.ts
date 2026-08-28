import { and, eq, inArray, sql } from "drizzle-orm";
import {
  MANUAL_ATTRIBUTION_FIELD_KEYS,
  buildManualConversionCandidates,
  hasRecordedManualAdvertisingConsent,
  type ManualConversionSnapshot,
} from "@/domain/analytics/manual-order-attribution";
import { hashMetaEmail, hashMetaPhone } from "@/server/analytics/meta-capi-client";
import type { getDatabase } from "@/server/db/client";
import {
  adminAuditLogs,
  invoices,
  orders,
  paymentRequests,
  productionFieldDefinitions,
  productionFieldValues,
  productionJobs,
} from "@/server/db/schema";

type Database = ReturnType<typeof getDatabase>;

export interface ManualConversionCandidateReader {
  findByJobId(jobId: string): Promise<ManualConversionSnapshot | null>;
}

export function createManualConversionCandidateService(
  reader: ManualConversionCandidateReader,
) {
  return Object.freeze({
    async list(jobId: string) {
      const snapshot = await reader.findByJobId(jobId);
      return snapshot ? buildManualConversionCandidates(snapshot) : Object.freeze([]);
    },
  });
}

export function createDrizzleManualConversionCandidateReader(
  database: Database,
): ManualConversionCandidateReader {
  return Object.freeze({
    async findByJobId(jobId: string) {
      const [job] = await database.select({
        source: productionJobs.source,
        customerSource: productionJobs.customerSource,
        jobNumber: productionJobs.jobNumber,
        manualPaymentStatus: productionJobs.manualPaymentStatus,
        customerEmail: productionJobs.customerEmail,
        customerPhone: productionJobs.customerPhone,
        amountPaidCents: productionJobs.amountPaidCents,
        linkedOnlineOrderNumber: orders.orderNumber,
        linkedPaymentRequestNumber: paymentRequests.requestNumber,
      }).from(productionJobs)
        .leftJoin(orders, eq(orders.orderNumber, productionJobs.webOrderNumber))
        .leftJoin(
          paymentRequests,
          eq(paymentRequests.requestNumber, productionJobs.webOrderNumber),
        )
        .where(eq(productionJobs.id, jobId))
        .limit(1);
      if (!job) return null;

      const [invoice, fields, paidAudit] = await Promise.all([
        database.select({
          status: invoices.status,
          currency: invoices.currency,
          totalInclGstCents: invoices.totalInclGstCents,
        }).from(invoices).where(eq(invoices.jobId, jobId)).limit(1),
        database.select({
          fieldKey: productionFieldDefinitions.fieldKey,
          value: productionFieldValues.value,
        }).from(productionFieldValues)
          .innerJoin(
            productionFieldDefinitions,
            eq(productionFieldDefinitions.id, productionFieldValues.fieldId),
          )
          .where(and(
            eq(productionFieldValues.jobId, jobId),
            inArray(productionFieldDefinitions.fieldKey, MANUAL_ATTRIBUTION_FIELD_KEYS),
          )),
        database.select({
          paidAt: sql<Date | null>`max(${adminAuditLogs.createdAt})`,
        }).from(adminAuditLogs).where(and(
          eq(adminAuditLogs.resourceType, "production_job"),
          eq(adminAuditLogs.resourceId, jobId),
          eq(adminAuditLogs.action, "production_job.updated"),
          eq(adminAuditLogs.result, "success"),
          sql`exists (
            select 1
            from jsonb_array_elements(
              case
                when jsonb_typeof(${adminAuditLogs.afterSummary} -> 'changes') = 'array'
                  then ${adminAuditLogs.afterSummary} -> 'changes'
                else '[]'::jsonb
              end
            ) change
            where change ->> 'field' = 'manualPaymentStatus'
              and change ->> 'after' = 'paid'
          )`,
        )).limit(1),
      ]);
      const customFields = Object.freeze(Object.fromEntries(fields.map((field) => [
        field.fieldKey,
        field.value,
      ])));
      const hasConsent = hasRecordedManualAdvertisingConsent(customFields);
      const email = job.customerEmail.trim();
      const phoneDigits = job.customerPhone.replace(/\D/g, "");
      return Object.freeze({
        source: job.source,
        customerSource: job.customerSource,
        jobNumber: job.jobNumber,
        manualPaymentStatus: job.manualPaymentStatus,
        paidAt: paidAudit[0]?.paidAt ?? null,
        amountPaidCents: job.amountPaidCents,
        linkedOnlineOrder: job.linkedOnlineOrderNumber !== null
          || job.linkedPaymentRequestNumber !== null,
        invoice: invoice[0] ?? null,
        metaMatching: Object.freeze({
          ...(hasConsent && email ? { hashedEmail: hashMetaEmail(email) } : {}),
          ...(hasConsent && phoneDigits ? { hashedPhone: hashMetaPhone(phoneDigits) } : {}),
        }),
        customFields,
      });
    },
  });
}
