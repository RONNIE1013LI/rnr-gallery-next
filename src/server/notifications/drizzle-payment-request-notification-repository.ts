import { and, asc, eq, inArray, lt, lte, or, sql } from "drizzle-orm";
import type { getDatabase } from "@/server/db/client";
import {
  paymentRequestNotificationOutbox,
  paymentRequests,
} from "@/server/db/schema";
import type {
  PaymentRequestNotificationDelivery,
  PaymentRequestNotificationRepository,
} from "./payment-request-notification-service";

type Database = ReturnType<typeof getDatabase>;

export function createDrizzlePaymentRequestNotificationRepository(
  database: Database,
): PaymentRequestNotificationRepository {
  return Object.freeze({
    async claimNext(now: Date): Promise<PaymentRequestNotificationDelivery | null> {
      const staleBefore = new Date(now.getTime() - 10 * 60_000);
      return database.transaction(async (transaction) => {
        const [row] = await transaction.select({
          notification: paymentRequestNotificationOutbox,
          requestNumber: paymentRequests.requestNumber,
          description: paymentRequests.description,
          currency: paymentRequests.currency,
          amountCents: paymentRequests.amountCents,
        }).from(paymentRequestNotificationOutbox)
          .innerJoin(
            paymentRequests,
            eq(paymentRequests.id, paymentRequestNotificationOutbox.paymentRequestId),
          )
          .where(and(
            lte(paymentRequestNotificationOutbox.availableAt, now),
            or(
              inArray(paymentRequestNotificationOutbox.status, ["pending", "failed"]),
              and(
                eq(paymentRequestNotificationOutbox.status, "sending"),
                sql`${paymentRequestNotificationOutbox.lastAttemptAt} is not null`,
                lt(paymentRequestNotificationOutbox.lastAttemptAt, staleBefore),
              ),
            ),
          ))
          .orderBy(
            asc(paymentRequestNotificationOutbox.createdAt),
            asc(paymentRequestNotificationOutbox.id),
          )
          .for("update", { skipLocked: true })
          .limit(1);
        if (!row) return null;
        const attempts = row.notification.attempts + 1;
        const [updated] = await transaction.update(paymentRequestNotificationOutbox).set({
          status: "sending",
          attempts,
          lastAttemptAt: now,
          updatedAt: now,
        }).where(and(
          eq(paymentRequestNotificationOutbox.id, row.notification.id),
          eq(paymentRequestNotificationOutbox.attempts, row.notification.attempts),
        )).returning({ id: paymentRequestNotificationOutbox.id });
        if (!updated) return null;
        return Object.freeze({
          id: row.notification.id,
          eventKey: row.notification.eventKey,
          kind: row.notification.kind,
          paymentRequestId: row.notification.paymentRequestId,
          requestNumber: row.requestNumber,
          description: row.description,
          recipientName: row.notification.recipientName,
          recipientEmail: row.notification.recipientEmail,
          currency: row.currency,
          amountCents: row.amountCents,
          status: "sending" as const,
          attempts,
          createdAt: row.notification.createdAt,
        });
      });
    },

    async markSent(id: string, providerMessageId: string, now: Date) {
      const [updated] = await database.update(paymentRequestNotificationOutbox).set({
        status: "sent",
        providerMessageId,
        lastErrorCode: null,
        sentAt: now,
        updatedAt: now,
      }).where(and(
        eq(paymentRequestNotificationOutbox.id, id),
        eq(paymentRequestNotificationOutbox.status, "sending"),
      )).returning({ id: paymentRequestNotificationOutbox.id });
      return Boolean(updated);
    },

    async markFailed(id: string, errorCode: string, availableAt: Date, now: Date) {
      const [updated] = await database.update(paymentRequestNotificationOutbox).set({
        status: "failed",
        lastErrorCode: errorCode,
        availableAt,
        updatedAt: now,
      }).where(and(
        eq(paymentRequestNotificationOutbox.id, id),
        eq(paymentRequestNotificationOutbox.status, "sending"),
      )).returning({ id: paymentRequestNotificationOutbox.id });
      return Boolean(updated);
    },
  });
}
