import { and, eq, inArray } from "drizzle-orm";
import {
  MANUAL_ATTRIBUTION_FIELD_KEYS,
  buildManualConversionCandidates,
  type ManualConversionSnapshot,
} from "@/domain/analytics/manual-order-attribution";
import type { getDatabase } from "@/server/db/client";
import {
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

      const [invoice, fields] = await Promise.all([
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
      ]);
      return Object.freeze({
        source: job.source,
        customerSource: job.customerSource,
        jobNumber: job.jobNumber,
        manualPaymentStatus: job.manualPaymentStatus,
        amountPaidCents: job.amountPaidCents,
        linkedOnlineOrder: job.linkedOnlineOrderNumber !== null
          || job.linkedPaymentRequestNumber !== null,
        invoice: invoice[0] ?? null,
        customFields: Object.freeze(Object.fromEntries(fields.map((field) => [
          field.fieldKey,
          field.value,
        ]))),
      });
    },
  });
}
