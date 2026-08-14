import { and, asc, eq, inArray, lt, lte, or, sql } from "drizzle-orm";
import type { getDatabase } from "@/server/db/client";
import {
  customerNotificationOutbox,
  orders,
  productionJobFiles,
  productionJobs,
} from "@/server/db/schema";
import type {
  CustomerNotificationDelivery,
  CustomerNotificationRepository,
} from "./customer-notification-service";

type Database = ReturnType<typeof getDatabase>;

export function createDrizzleCustomerNotificationRepository(
  database: Database,
): CustomerNotificationRepository {
  async function claim(now: Date, fileId?: string): Promise<CustomerNotificationDelivery | null> {
    const staleBefore = new Date(now.getTime() - 10 * 60_000);
    return database.transaction(async (transaction) => {
      const [row] = await transaction.select({
        notification: customerNotificationOutbox,
        orderNumber: orders.orderNumber,
        proofVersion: productionJobFiles.version,
        customerName: productionJobs.customerName,
      }).from(customerNotificationOutbox)
        .innerJoin(orders, eq(orders.id, customerNotificationOutbox.orderId))
        .innerJoin(productionJobs, eq(productionJobs.id, customerNotificationOutbox.jobId))
        .innerJoin(productionJobFiles, eq(productionJobFiles.id, customerNotificationOutbox.fileId))
        .where(and(
          eq(customerNotificationOutbox.kind, "proof_ready"),
          fileId ? eq(customerNotificationOutbox.fileId, fileId) : undefined,
          lte(customerNotificationOutbox.availableAt, now),
          or(
            inArray(customerNotificationOutbox.status, ["pending", "failed"]),
            and(
              eq(customerNotificationOutbox.status, "sending"),
              sql`${customerNotificationOutbox.lastAttemptAt} is not null`,
              lt(customerNotificationOutbox.lastAttemptAt, staleBefore),
            ),
          ),
        ))
        .orderBy(asc(customerNotificationOutbox.createdAt), asc(customerNotificationOutbox.id))
        .for("update", { skipLocked: true })
        .limit(1);
      if (!row || row.proofVersion === null) return null;
      const attempts = row.notification.attempts + 1;
      const [updated] = await transaction.update(customerNotificationOutbox).set({
        status: "sending",
        attempts,
        lastAttemptAt: now,
        updatedAt: now,
      }).where(and(
        eq(customerNotificationOutbox.id, row.notification.id),
        eq(customerNotificationOutbox.attempts, row.notification.attempts),
      )).returning({ id: customerNotificationOutbox.id });
      if (!updated) return null;
      return Object.freeze({
        id: row.notification.id,
        eventKey: row.notification.eventKey,
        kind: row.notification.kind,
        jobId: row.notification.jobId,
        orderId: row.notification.orderId,
        orderNumber: row.orderNumber,
        fileId: row.notification.fileId,
        proofVersion: row.proofVersion,
        customerName: row.customerName,
        recipientEmail: row.notification.recipientEmail,
        status: "sending" as const,
        attempts,
        createdAt: row.notification.createdAt,
      });
    });
  }

  return Object.freeze<CustomerNotificationRepository>({
    claimForFile: (fileId, now) => claim(now, fileId),
    claimNext: (now) => claim(now),

    async markSent(id, providerMessageId, now) {
      return database.transaction(async (transaction) => {
        const [updated] = await transaction.update(customerNotificationOutbox).set({
          status: "sent",
          providerMessageId,
          lastErrorCode: null,
          sentAt: now,
          updatedAt: now,
        }).where(and(
          eq(customerNotificationOutbox.id, id),
          eq(customerNotificationOutbox.status, "sending"),
        )).returning({ id: customerNotificationOutbox.id, jobId: customerNotificationOutbox.jobId });
        if (!updated) return false;
        await transaction.update(productionJobs).set({
          customerNotifiedAt: sql`coalesce(${productionJobs.customerNotifiedAt}, ${now})`,
          updatedAt: now,
        }).where(eq(productionJobs.id, updated.jobId));
        return true;
      });
    },

    async markFailed(id, errorCode, availableAt, now) {
      const [updated] = await database.update(customerNotificationOutbox).set({
        status: "failed",
        lastErrorCode: errorCode,
        availableAt,
        updatedAt: now,
      }).where(and(
        eq(customerNotificationOutbox.id, id),
        eq(customerNotificationOutbox.status, "sending"),
      )).returning({ id: customerNotificationOutbox.id });
      return Boolean(updated);
    },

    async listForJob(jobId) {
      const rows = await database.select({
        fileId: customerNotificationOutbox.fileId,
        status: customerNotificationOutbox.status,
        attempts: customerNotificationOutbox.attempts,
        lastErrorCode: customerNotificationOutbox.lastErrorCode,
        sentAt: customerNotificationOutbox.sentAt,
      }).from(customerNotificationOutbox)
        .where(eq(customerNotificationOutbox.jobId, jobId))
        .orderBy(asc(customerNotificationOutbox.createdAt));
      return Object.freeze(rows.map((row) => Object.freeze(row)));
    },
  });
}
