import { and, asc, eq, lte, sql } from "drizzle-orm";
import { getDatabase } from "@/server/db/client";
import {
  adminAuditLogs,
  productionJobFiles,
  productionJobs,
} from "@/server/db/schema";
import type { PaymentProofRetentionRepository } from "./payment-proof-retention-cleanup";

type Database = ReturnType<typeof getDatabase>;

function arrivedBefore(cutoff: Date) {
  return sql`coalesce(
    (
      select max(arrival_audit.created_at)
      from admin_audit_logs arrival_audit
      where arrival_audit.resource_type = 'production_job'
        and arrival_audit.resource_id = ${productionJobs.id}::text
        and arrival_audit.action = 'production_job.updated'
        and exists (
          select 1
          from jsonb_array_elements(
            case
              when jsonb_typeof(arrival_audit.after_summary -> 'changes') = 'array'
                then arrival_audit.after_summary -> 'changes'
              else '[]'::jsonb
            end
          ) change
          where change ->> 'field' = 'paymentReconciliationStatus'
            and change ->> 'after' = 'Arrive'
        )
    ),
    ${productionJobs.updatedAt}
  ) <= ${cutoff}`;
}

function eligible(cutoff: Date) {
  return and(
    eq(productionJobFiles.kind, "payment_proof"),
    eq(productionJobs.paymentReconciliationStatus, "Arrive"),
    lte(productionJobFiles.createdAt, cutoff),
    arrivedBefore(cutoff),
  );
}

export function createDrizzlePaymentProofRetentionRepository(
  database: Database,
): PaymentProofRetentionRepository {
  return Object.freeze({
    async report(cutoff) {
      const [result] = await database.select({
        eligible: sql<number>`count(*)::int`,
        eligibleBytes: sql<number>`coalesce(sum(${productionJobFiles.sizeBytes}), 0)::int`,
      }).from(productionJobFiles)
        .innerJoin(productionJobs, eq(productionJobs.id, productionJobFiles.jobId))
        .where(eligible(cutoff));
      return Object.freeze({
        eligible: result?.eligible ?? 0,
        eligibleBytes: result?.eligibleBytes ?? 0,
      });
    },

    async listCandidates(cutoff, limit) {
      return database.select({ id: productionJobFiles.id })
        .from(productionJobFiles)
        .innerJoin(productionJobs, eq(productionJobs.id, productionJobFiles.jobId))
        .where(eligible(cutoff))
        .orderBy(asc(productionJobFiles.createdAt), asc(productionJobFiles.id))
        .limit(limit);
    },

    async purge(id, cutoff, purgedAt, remove) {
      return database.transaction(async (transaction) => {
        const [file] = await transaction.select({
          id: productionJobFiles.id,
          jobId: productionJobFiles.jobId,
          storageKey: productionJobFiles.storageKey,
          sizeBytes: productionJobFiles.sizeBytes,
        }).from(productionJobFiles)
          .innerJoin(productionJobs, eq(productionJobs.id, productionJobFiles.jobId))
          .where(and(eq(productionJobFiles.id, id), eligible(cutoff)))
          .limit(1)
          .for("update");

        if (!file) return "ineligible" as const;

        await remove({ id: file.id, storageKey: file.storageKey });
        await transaction.delete(productionJobFiles)
          .where(eq(productionJobFiles.id, file.id));
        await transaction.insert(adminAuditLogs).values({
          actorUserId: "system:payment-proof-retention",
          actorEmail: "system@rrgallery.invalid",
          action: "production_file.retention_deleted",
          resourceType: "production_job",
          resourceId: file.jobId,
          beforeSummary: {
            fileId: file.id,
            kind: "payment_proof",
            sizeBytes: file.sizeBytes,
          },
          requestSource: "cron.payment-proof-retention",
          result: "success",
          idempotencyKey: `payment-proof-retention:${file.id}`,
          createdAt: purgedAt,
        });
        return "deleted" as const;
      });
    },
  });
}
