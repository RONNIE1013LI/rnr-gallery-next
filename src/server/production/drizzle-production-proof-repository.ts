import { and, asc, desc, eq, max, ne, sql } from "drizzle-orm";
import type { getDatabase } from "@/server/db/client";
import {
  adminAuditLogs,
  checkoutSessions,
  customerNotificationOutbox,
  orders,
  orderStatusHistory,
  productionJobFiles,
  productionJobs,
  productionProofReviews,
} from "@/server/db/schema";
import { buildAuditRecord } from "@/server/admin/audit-service";
import { enqueueInternalNotifications } from "@/server/notifications/drizzle-internal-notification-outbox-repository";
import type {
  CustomerProofAccess,
  ProductionFileSummary,
  ProductionProofRepository,
} from "./production-proof-service";

type Database = ReturnType<typeof getDatabase>;
type FileRow = typeof productionJobFiles.$inferSelect;
type ReviewRow = typeof productionProofReviews.$inferSelect;

function summary(file: FileRow, review: ReviewRow | null): ProductionFileSummary {
  return Object.freeze({
    id: file.id,
    jobId: file.jobId,
    kind: file.kind,
    version: file.version,
    originalName: file.originalName,
    mediaType: file.mediaType,
    sizeBytes: file.sizeBytes,
    createdAt: file.createdAt,
    review: review ? Object.freeze({
      id: review.id,
      decision: review.decision,
      notes: review.notes,
      reviewerType: review.reviewerType,
      createdAt: review.createdAt,
    }) : null,
  });
}

function customerOrderAccess(access: CustomerProofAccess) {
  if (access.kind === "customer") return eq(orders.customerId, access.userId);
  if (access.kind === "checkout") {
    return sql`exists (
      select 1 from ${checkoutSessions}
      where ${checkoutSessions.id} = ${orders.checkoutSessionId}
        and ${checkoutSessions.tokenDigest} = ${access.tokenDigest}
        and ${checkoutSessions.completedAt} is not null
        and ${checkoutSessions.expiresAt} > clock_timestamp()
    )`;
  }
  return sql`exists (
    select 1 from ${productionJobFiles} signed_proof
    where signed_proof.job_id = ${productionJobs.id}
      and signed_proof.id = ${access.fileId}
      and signed_proof.kind = 'design_draft'
  )`;
}

async function findCustomerJob(
  executor: Pick<Database, "select">,
  orderNumber: string,
  access: CustomerProofAccess,
) {
  const [row] = await executor.select({
    jobId: productionJobs.id,
    orderId: orders.id,
    customerId: orders.customerId,
    customerEmail: orders.customerEmail,
    paymentStatus: orders.paymentStatus,
    fulfilmentStatus: orders.fulfilmentStatus,
  }).from(productionJobs)
    .innerJoin(orders, eq(orders.id, productionJobs.orderId))
    .where(and(
      eq(orders.orderNumber, orderNumber),
      customerOrderAccess(access),
    ))
    .limit(1);
  return row ?? null;
}

async function findByKey(database: Database, idempotencyKey: string) {
  const [row] = await database.select({
    file: productionJobFiles,
    review: productionProofReviews,
  }).from(productionJobFiles)
    .leftJoin(productionProofReviews, eq(productionProofReviews.fileId, productionJobFiles.id))
    .where(eq(productionJobFiles.idempotencyKey, idempotencyKey))
    .limit(1);
  return row ? Object.freeze({
    ...summary(row.file, row.review),
    requestDigest: row.file.requestDigest,
  }) : null;
}

export function createDrizzleProductionProofRepository(
  database: Database,
): ProductionProofRepository {
  return {
    findFileByIdempotencyKey: (idempotencyKey) => findByKey(database, idempotencyKey),

    async createFile(input) {
      try {
        return await database.transaction(async (transaction) => {
          const [job] = await transaction.select({
            id: productionJobs.id,
            source: productionJobs.source,
            orderId: productionJobs.orderId,
            customerEmail: productionJobs.customerEmail,
            manualStatus: productionJobs.manualStatus,
          })
            .from(productionJobs)
            .where(eq(productionJobs.id, input.jobId))
            .for("update")
            .limit(1);
          if (!job) return { result: "not_found" as const };

          let webOrder: Readonly<{
            paymentStatus: typeof orders.$inferSelect.paymentStatus;
            fulfilmentStatus: typeof orders.$inferSelect.fulfilmentStatus;
          }> | null = null;
          if (job.source === "web" && job.orderId) {
            const [order] = await transaction.select({
              paymentStatus: orders.paymentStatus,
              fulfilmentStatus: orders.fulfilmentStatus,
            }).from(orders).where(eq(orders.id, job.orderId)).for("update").limit(1);
            if (!order) return { result: "not_found" as const };
            if (["design_draft", "print_file"].includes(input.kind) && order.paymentStatus !== "paid") {
              return { result: "payment_required" as const };
            }
            webOrder = order;
          }

          const [prior] = await transaction.select()
            .from(productionJobFiles)
            .where(eq(productionJobFiles.idempotencyKey, input.idempotencyKey))
            .limit(1);
          if (prior) {
            return prior.requestDigest === input.requestDigest
              ? { result: "duplicate" as const, file: summary(prior, null) }
              : { result: "conflict" as const };
          }

          let version: number | null = null;
          if (input.kind === "design_draft") {
            const [versionRow] = await transaction.select({ value: max(productionJobFiles.version) })
              .from(productionJobFiles)
              .where(and(
                eq(productionJobFiles.jobId, input.jobId),
                eq(productionJobFiles.kind, "design_draft"),
              ));
            version = (versionRow?.value ?? 0) + 1;
          }
          const [file] = await transaction.insert(productionJobFiles).values({
            id: input.reference.id,
            jobId: input.jobId,
            kind: input.kind,
            version,
            originalName: input.reference.originalName,
            mediaType: input.reference.mimeType,
            sizeBytes: input.reference.size,
            storageKey: input.reference.storageKey,
            sha256: input.reference.sha256,
            idempotencyKey: input.idempotencyKey,
            requestDigest: input.requestDigest,
            uploadedByUserId: input.actor.userId,
            createdAt: input.createdAt,
          }).returning();
          if (file.kind === "design_draft") {
            if (job.source === "web" && job.orderId && webOrder) {
              const mutableStatuses = [
                "new",
                "designing",
                "awaiting_customer",
                "ready_to_print",
                "on_hold",
              ] as const;
              if (mutableStatuses.includes(webOrder.fulfilmentStatus as typeof mutableStatuses[number])) {
                if (webOrder.fulfilmentStatus !== "awaiting_customer") {
                  await transaction.update(orders).set({
                    fulfilmentStatus: "awaiting_customer",
                    updatedAt: input.createdAt,
                  }).where(and(
                    eq(orders.id, job.orderId),
                    eq(orders.fulfilmentStatus, webOrder.fulfilmentStatus),
                    eq(orders.paymentStatus, "paid"),
                  ));
                  await transaction.insert(orderStatusHistory).values({
                    orderId: job.orderId,
                    fromStatus: webOrder.fulfilmentStatus,
                    toStatus: "awaiting_customer",
                    actorUserId: input.actor.userId,
                    reason: `Design draft v${file.version} uploaded`,
                    idempotencyKey: `proof-upload-status:${file.id}`,
                    createdAt: input.createdAt,
                  });
                }
                await transaction.insert(customerNotificationOutbox).values({
                  eventKey: `proof-ready:${file.id}`,
                  kind: "proof_ready",
                  jobId: job.id,
                  orderId: job.orderId,
                  fileId: file.id,
                  recipientEmail: job.customerEmail,
                  availableAt: input.createdAt,
                  createdAt: input.createdAt,
                  updatedAt: input.createdAt,
                }).onConflictDoNothing({ target: customerNotificationOutbox.eventKey });
              }
            } else if (job.source === "manual" && job.manualStatus && ![
              "printing",
              "shipped",
              "completed",
              "cancelled",
            ].includes(job.manualStatus)) {
              await transaction.update(productionJobs).set({
                manualStatus: "awaiting_customer",
                updatedAt: input.createdAt,
              }).where(eq(productionJobs.id, job.id));
            }
          }
          await transaction.insert(adminAuditLogs).values(buildAuditRecord({
            actorUserId: input.actor.userId,
            actorEmail: input.actor.email,
            action: "production_file.uploaded",
            resourceType: "production_job",
            resourceId: input.jobId,
            afterSummary: {
              fileId: file.id,
              kind: file.kind,
              version: file.version,
              originalName: file.originalName,
              sizeBytes: file.sizeBytes,
            },
            requestSource: "admin.jobs.files",
            result: "success",
            idempotencyKey: input.idempotencyKey,
          }));
          return { result: "created" as const, file: summary(file, null) };
        });
      } catch (error) {
        const existing = await findByKey(database, input.idempotencyKey);
        if (!existing) throw error;
        return existing.requestDigest === input.requestDigest
          ? { result: "duplicate" as const, file: existing }
          : { result: "conflict" as const };
      }
    },

    async deletePaymentProof(input) {
      return database.transaction(async (transaction) => {
        const [file] = await transaction.select()
          .from(productionJobFiles)
          .where(and(
            eq(productionJobFiles.id, input.fileId),
            eq(productionJobFiles.jobId, input.jobId),
          ))
          .for("update")
          .limit(1);
        if (!file) return { result: "not_found" as const };
        if (file.kind !== "payment_proof") return { result: "invalid_kind" as const };

        await transaction.delete(productionJobFiles).where(and(
          eq(productionJobFiles.id, input.fileId),
          eq(productionJobFiles.jobId, input.jobId),
        ));
        await transaction.insert(adminAuditLogs).values({ ...buildAuditRecord({
          actorUserId: input.actor.userId,
          actorEmail: input.actor.email,
          action: "production_file.deleted",
          resourceType: "production_job",
          resourceId: input.jobId,
          beforeSummary: {
            fileId: file.id,
            kind: file.kind,
            originalName: file.originalName,
            sizeBytes: file.sizeBytes,
          },
          requestSource: "forms.jobs.files",
          result: "success",
          idempotencyKey: `payment-proof-delete:${file.id}`,
        }), createdAt: input.createdAt });
        return { result: "deleted" as const, storageKey: file.storageKey };
      });
    },

    async recordReview(input) {
      return database.transaction(async (transaction) => {
        const [priorByKey] = await transaction.select()
          .from(productionProofReviews)
          .where(eq(productionProofReviews.idempotencyKey, input.idempotencyKey))
          .limit(1);
        if (priorByKey) {
          const same = priorByKey.jobId === input.jobId &&
            priorByKey.fileId === input.fileId &&
            priorByKey.decision === input.decision &&
            priorByKey.notes === input.notes;
          return same
            ? { result: "duplicate" as const, review: Object.freeze({
                id: priorByKey.id,
                fileId: priorByKey.fileId,
                decision: priorByKey.decision,
                notes: priorByKey.notes,
                createdAt: priorByKey.createdAt,
              }) }
            : { result: "conflict" as const };
        }

        const [file] = await transaction.select().from(productionJobFiles)
          .where(and(
            eq(productionJobFiles.id, input.fileId),
            eq(productionJobFiles.jobId, input.jobId),
          )).for("update").limit(1);
        if (!file) return { result: "not_found" as const };
        if (file.kind !== "design_draft" || file.version === null) {
          return { result: "invalid_file" as const };
        }
        const [existingReview] = await transaction.select({ id: productionProofReviews.id })
          .from(productionProofReviews)
          .where(eq(productionProofReviews.fileId, input.fileId))
          .limit(1);
        if (existingReview) return { result: "conflict" as const };

        const [job] = await transaction.select({
          source: productionJobs.source,
          orderId: productionJobs.orderId,
          manualStatus: productionJobs.manualStatus,
        }).from(productionJobs)
          .where(eq(productionJobs.id, input.jobId))
          .for("update")
          .limit(1);
        if (!job) return { result: "not_found" as const };
        const nextStatus = input.decision === "approved" ? "ready_to_print" : "designing";
        if (job.source === "web" && job.orderId) {
          const [order] = await transaction.select({
            paymentStatus: orders.paymentStatus,
          }).from(orders).where(eq(orders.id, job.orderId)).for("update").limit(1);
          if (!order) return { result: "not_found" as const };
          if (order.paymentStatus !== "paid") return { result: "payment_required" as const };
          const [updatedOrder] = await transaction.update(orders).set({
            fulfilmentStatus: nextStatus,
            updatedAt: input.createdAt,
          }).where(and(
            eq(orders.id, job.orderId),
            eq(orders.fulfilmentStatus, "awaiting_customer"),
            eq(orders.paymentStatus, "paid"),
          )).returning({ id: orders.id });
          if (!updatedOrder) return { result: "invalid_status" as const };
        } else if (job.source === "manual" && job.manualStatus === "awaiting_customer") {
          const [updatedJob] = await transaction.update(productionJobs).set({
            manualStatus: nextStatus,
            updatedAt: input.createdAt,
          }).where(and(
            eq(productionJobs.id, input.jobId),
            eq(productionJobs.manualStatus, "awaiting_customer"),
          )).returning({ id: productionJobs.id });
          if (!updatedJob) return { result: "invalid_status" as const };
        } else {
          return { result: "invalid_status" as const };
        }

        const [review] = await transaction.insert(productionProofReviews).values({
          jobId: input.jobId,
          fileId: input.fileId,
          decision: input.decision,
          notes: input.notes,
          reviewerType: "staff",
          recordedByUserId: input.actor.userId,
          idempotencyKey: input.idempotencyKey,
          createdAt: input.createdAt,
        }).returning();
        if (job.source === "web" && job.orderId) {
          await transaction.insert(orderStatusHistory).values({
            orderId: job.orderId,
            fromStatus: "awaiting_customer",
            toStatus: nextStatus,
            actorUserId: input.actor.userId,
            reason: input.decision === "approved"
              ? `Staff recorded approval for design draft v${file.version}`
              : `Staff recorded requested changes for design draft v${file.version}`,
            idempotencyKey: `proof-review-status:${review.id}`,
            createdAt: input.createdAt,
          });
        }
        await transaction.insert(adminAuditLogs).values(buildAuditRecord({
          actorUserId: input.actor.userId,
          actorEmail: input.actor.email,
          action: "production_proof.reviewed",
          resourceType: "production_job",
          resourceId: input.jobId,
          afterSummary: {
            fileId: review.fileId,
            version: file.version,
            decision: review.decision,
            hasNotes: Boolean(review.notes),
            fulfilmentStatus: nextStatus,
          },
          requestSource: "admin.jobs.proofs",
          result: "success",
          idempotencyKey: input.idempotencyKey,
        }));
        return { result: "created" as const, review: Object.freeze({
          id: review.id,
          fileId: review.fileId,
          decision: review.decision,
          notes: review.notes,
          reviewerType: review.reviewerType,
          createdAt: review.createdAt,
        }) };
      });
    },

    async listCustomerProofs(orderNumber, access) {
      return database.transaction(async (transaction) => {
        const job = await findCustomerJob(transaction, orderNumber, access);
        if (!job) return null;
        const rows = await transaction.select({
          file: productionJobFiles,
          review: productionProofReviews,
        }).from(productionJobFiles)
          .leftJoin(productionProofReviews, eq(productionProofReviews.fileId, productionJobFiles.id))
          .where(and(
            eq(productionJobFiles.jobId, job.jobId),
            eq(productionJobFiles.kind, "design_draft"),
            access.kind === "signed" ? eq(productionJobFiles.id, access.fileId) : undefined,
          ))
          .orderBy(desc(productionJobFiles.version), desc(productionJobFiles.createdAt));
        return Object.freeze({
          orderNumber,
          fulfilmentStatus: job.fulfilmentStatus,
          files: Object.freeze(rows.flatMap(({ file, review }) => file.version === null ? [] : [Object.freeze({
            id: file.id,
            version: file.version,
            originalName: file.originalName,
            mediaType: file.mediaType,
            sizeBytes: file.sizeBytes,
            createdAt: file.createdAt,
            review: summary(file, review).review,
          })])),
        });
      }, { isolationLevel: "repeatable read", accessMode: "read only" });
    },

    async findCustomerPrivateFile(orderNumber, fileId, access) {
      return database.transaction(async (transaction) => {
        const job = await findCustomerJob(transaction, orderNumber, access);
        if (!job || (access.kind === "signed" && access.fileId !== fileId)) return null;
        const [row] = await transaction.select({
          file: productionJobFiles,
          review: productionProofReviews,
        }).from(productionJobFiles)
          .leftJoin(productionProofReviews, eq(productionProofReviews.fileId, productionJobFiles.id))
          .where(and(
            eq(productionJobFiles.jobId, job.jobId),
            eq(productionJobFiles.id, fileId),
            eq(productionJobFiles.kind, "design_draft"),
          )).limit(1);
        return row ? Object.freeze({
          ...summary(row.file, row.review),
          storageKey: row.file.storageKey,
        }) : null;
      }, { isolationLevel: "repeatable read", accessMode: "read only" });
    },

    async recordCustomerReview(input) {
      return database.transaction(async (transaction) => {
        const [priorByKey] = await transaction.select()
          .from(productionProofReviews)
          .where(eq(productionProofReviews.idempotencyKey, input.idempotencyKey))
          .limit(1);
        if (priorByKey) {
          const same = priorByKey.fileId === input.fileId &&
            priorByKey.decision === input.decision &&
            priorByKey.notes === input.notes &&
            priorByKey.reviewerType === "customer";
          return same
            ? { result: "duplicate" as const, review: Object.freeze({
                id: priorByKey.id,
                fileId: priorByKey.fileId,
                decision: priorByKey.decision,
                notes: priorByKey.notes,
                reviewerType: "customer" as const,
                createdAt: priorByKey.createdAt,
              }) }
            : { result: "conflict" as const };
        }

        const job = await findCustomerJob(transaction, input.orderNumber, input.access);
        if (!job || (input.access.kind === "signed" && input.access.fileId !== input.fileId)) {
          return { result: "not_found" as const };
        }
        const [file] = await transaction.select().from(productionJobFiles)
          .where(and(
            eq(productionJobFiles.id, input.fileId),
            eq(productionJobFiles.jobId, job.jobId),
          )).for("update").limit(1);
        if (!file || file.kind !== "design_draft" || file.version === null) {
          return { result: "invalid_file" as const };
        }
        const [latest] = await transaction.select({ value: max(productionJobFiles.version) })
          .from(productionJobFiles)
          .where(and(
            eq(productionJobFiles.jobId, job.jobId),
            eq(productionJobFiles.kind, "design_draft"),
          ));
        if (latest?.value !== file.version) return { result: "invalid_file" as const };
        const [existingReview] = await transaction.select({ id: productionProofReviews.id })
          .from(productionProofReviews)
          .where(eq(productionProofReviews.fileId, input.fileId))
          .limit(1);
        if (existingReview) return { result: "conflict" as const };
        if (job.fulfilmentStatus !== "awaiting_customer") {
          return { result: "invalid_status" as const };
        }
        if (job.paymentStatus !== "paid") {
          return { result: "payment_required" as const };
        }

        const nextStatus = input.decision === "approved" ? "ready_to_print" : "designing";
        const [updatedOrder] = await transaction.update(orders).set({
          fulfilmentStatus: nextStatus,
          updatedAt: input.createdAt,
        }).where(and(
          eq(orders.id, job.orderId),
          eq(orders.fulfilmentStatus, "awaiting_customer"),
          eq(orders.paymentStatus, "paid"),
        )).returning({ id: orders.id });
        if (!updatedOrder) return { result: "invalid_status" as const };

        const [review] = await transaction.insert(productionProofReviews).values({
          jobId: job.jobId,
          fileId: input.fileId,
          decision: input.decision,
          notes: input.notes,
          reviewerType: "customer",
          recordedByUserId: input.access.kind === "customer" ? input.access.userId : null,
          idempotencyKey: input.idempotencyKey,
          createdAt: input.createdAt,
        }).returning();
        await transaction.insert(orderStatusHistory).values({
          orderId: job.orderId,
          fromStatus: "awaiting_customer",
          toStatus: nextStatus,
          actorUserId: input.access.kind === "customer" ? input.access.userId : null,
          reason: input.decision === "approved"
            ? `Customer approved design draft v${file.version}`
            : `Customer requested changes to design draft v${file.version}`,
          idempotencyKey: `proof-review-status:${review.id}`,
          createdAt: input.createdAt,
        });
        await transaction.insert(adminAuditLogs).values(buildAuditRecord({
          actorUserId: input.access.kind === "customer"
            ? input.access.userId
            : `guest-order:${job.orderId}`,
          actorEmail: job.customerEmail,
          action: "production_proof.customer_reviewed",
          resourceType: "production_job",
          resourceId: job.jobId,
          afterSummary: {
            fileId: review.fileId,
            version: file.version,
            decision: review.decision,
            hasNotes: Boolean(review.notes),
            fulfilmentStatus: nextStatus,
          },
          requestSource: "customer.order.proof",
          result: "success",
          idempotencyKey: input.idempotencyKey,
        }));
        await enqueueInternalNotifications(transaction, {
          topic: input.decision === "approved"
            ? "proof_approved"
            : "proof_changes_requested",
          sourceEventId: review.id,
          resourceType: "proof_review",
          resourceId: review.id,
          resourceReference: input.orderNumber,
          payload: { version: 1, adminPath: `/admin/jobs/${job.jobId}` },
          createdAt: input.createdAt,
        });
        return { result: "created" as const, review: Object.freeze({
          id: review.id,
          fileId: review.fileId,
          decision: review.decision,
          notes: review.notes,
          reviewerType: "customer" as const,
          createdAt: review.createdAt,
        }) };
      });
    },

    async listJobFiles(jobId, permissions) {
      const rows = await database.select({ file: productionJobFiles, review: productionProofReviews })
        .from(productionJobFiles)
        .leftJoin(productionProofReviews, eq(productionProofReviews.fileId, productionJobFiles.id))
        .where(permissions.canViewPaymentProof
          ? eq(productionJobFiles.jobId, jobId)
          : and(eq(productionJobFiles.jobId, jobId), ne(productionJobFiles.kind, "payment_proof")))
        .orderBy(asc(productionJobFiles.kind), desc(productionJobFiles.version), desc(productionJobFiles.createdAt));
      return Object.freeze(rows.map((row) => summary(row.file, row.review)));
    },

    async findPrivateFile(jobId, fileId) {
      const [row] = await database.select({ file: productionJobFiles, review: productionProofReviews })
        .from(productionJobFiles)
        .leftJoin(productionProofReviews, eq(productionProofReviews.fileId, productionJobFiles.id))
        .where(and(eq(productionJobFiles.jobId, jobId), eq(productionJobFiles.id, fileId)))
        .limit(1);
      return row ? Object.freeze({ ...summary(row.file, row.review), storageKey: row.file.storageKey }) : null;
    },
  };
}
