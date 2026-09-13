import { and, asc, eq, inArray, lt, lte, or, sql } from "drizzle-orm";
import type { getDatabase } from "@/server/db/client";
import {
  orderAddresses,
  orderNotificationOutbox,
  orders,
  manualOrderNotificationOutbox,
  productionJobs,
} from "@/server/db/schema";
import type {
  OrderNotificationDelivery,
  OrderNotificationRepository,
} from "./order-notification-service";

type Database = ReturnType<typeof getDatabase>;

export function createDrizzleOrderNotificationRepository(
  database: Database,
): OrderNotificationRepository {
  return Object.freeze({
    async claimNext(now: Date): Promise<OrderNotificationDelivery | null> {
      const staleBefore = new Date(now.getTime() - 10 * 60_000);
      return database.transaction(async (transaction) => {
        const [row] = await transaction.select({
          notification: orderNotificationOutbox,
          orderNumber: orders.orderNumber,
          currency: orders.currency,
          paymentStatus: orders.paymentStatus,
          totalInclGstCents: orders.totalInclGstCents,
          trackingNumber: orders.trackingNumber,
          trackingCarrier: orders.trackingCarrier,
          trackingUrl: orders.trackingUrl,
          customerName: orderAddresses.fullName,
        }).from(orderNotificationOutbox)
          .innerJoin(orders, eq(orders.id, orderNotificationOutbox.orderId))
          .innerJoin(orderAddresses, and(
            eq(orderAddresses.orderId, orders.id),
            eq(orderAddresses.kind, "billing"),
          ))
          .where(and(
            lte(orderNotificationOutbox.availableAt, now),
            or(
              inArray(orderNotificationOutbox.status, ["pending", "failed"]),
              and(
                eq(orderNotificationOutbox.status, "sending"),
                sql`${orderNotificationOutbox.lastAttemptAt} is not null`,
                lt(orderNotificationOutbox.lastAttemptAt, staleBefore),
              ),
            ),
          ))
          .orderBy(asc(orderNotificationOutbox.createdAt), asc(orderNotificationOutbox.id))
          .for("update", { skipLocked: true })
          .limit(1);
        if (!row) {
          const [manual] = await transaction.select({
            notification: manualOrderNotificationOutbox,
            jobNumber: productionJobs.jobNumber,
            customerName: productionJobs.customerName,
            trackingNumber: productionJobs.trackingNumber,
            trackingCarrier: productionJobs.trackingCarrier,
            trackingUrl: productionJobs.trackingUrl,
          }).from(manualOrderNotificationOutbox)
            .innerJoin(productionJobs, eq(productionJobs.id, manualOrderNotificationOutbox.jobId))
            .where(and(
              lte(manualOrderNotificationOutbox.availableAt, now),
              or(
                inArray(manualOrderNotificationOutbox.status, ["pending", "failed"]),
                and(
                  eq(manualOrderNotificationOutbox.status, "sending"),
                  sql`${manualOrderNotificationOutbox.lastAttemptAt} is not null`,
                  lt(manualOrderNotificationOutbox.lastAttemptAt, staleBefore),
                ),
              ),
            )).orderBy(asc(manualOrderNotificationOutbox.createdAt), asc(manualOrderNotificationOutbox.id))
            .for("update", { skipLocked: true }).limit(1);
          if (!manual) return null;
          const [updated] = await transaction.update(manualOrderNotificationOutbox).set({
            status: "sending", attempts: manual.notification.attempts + 1, lastAttemptAt: now, updatedAt: now,
          }).where(and(eq(manualOrderNotificationOutbox.id, manual.notification.id), eq(manualOrderNotificationOutbox.attempts, manual.notification.attempts))).returning({ id: manualOrderNotificationOutbox.id });
          if (!updated || !manual.notification.recipientEmail) {
            if (updated) await transaction.update(manualOrderNotificationOutbox).set({ status: "skipped", updatedAt: now }).where(eq(manualOrderNotificationOutbox.id, manual.notification.id));
            return null;
          }
          return Object.freeze({ id: manual.notification.id, eventKey: manual.notification.eventKey, kind: "order_shipped" as const, orderId: manual.notification.jobId, orderNumber: manual.jobNumber, customerName: manual.customerName, recipientEmail: manual.notification.recipientEmail, currency: "NZD" as const, paymentStatus: "paid" as const, totalInclGstCents: 0, trackingNumber: manual.trackingNumber, trackingCarrier: manual.trackingCarrier, trackingUrl: manual.trackingUrl, status: "sending" as const, attempts: manual.notification.attempts + 1, createdAt: manual.notification.createdAt, source: "manual" as const });
        }
        const attempts = row.notification.attempts + 1;
        const [updated] = await transaction.update(orderNotificationOutbox).set({
          status: "sending",
          attempts,
          lastAttemptAt: now,
          updatedAt: now,
        }).where(and(
          eq(orderNotificationOutbox.id, row.notification.id),
          eq(orderNotificationOutbox.attempts, row.notification.attempts),
        )).returning({ id: orderNotificationOutbox.id });
        if (!updated) return null;
        return Object.freeze({
          id: row.notification.id,
          eventKey: row.notification.eventKey,
          kind: row.notification.kind,
          orderId: row.notification.orderId,
          orderNumber: row.orderNumber,
          customerName: row.customerName,
          recipientEmail: row.notification.recipientEmail,
          currency: row.currency,
          paymentStatus: row.paymentStatus,
          totalInclGstCents: row.totalInclGstCents,
          trackingNumber: row.trackingNumber,
          trackingCarrier: row.trackingCarrier,
          trackingUrl: row.trackingUrl,
          status: "sending" as const,
          attempts,
          createdAt: row.notification.createdAt,
          source: "order" as const,
        });
      });
    },

    async discard(id: string) {
      const [deleted] = await database.delete(orderNotificationOutbox).where(and(
        eq(orderNotificationOutbox.id, id),
        eq(orderNotificationOutbox.kind, "payment_failed"),
        eq(orderNotificationOutbox.status, "sending"),
      )).returning({ id: orderNotificationOutbox.id });
      return Boolean(deleted);
    },

    async markSent(id: string, providerMessageId: string, now: Date) {
      const [updated] = await database.update(orderNotificationOutbox).set({
        status: "sent",
        providerMessageId,
        lastErrorCode: null,
        sentAt: now,
        updatedAt: now,
      }).where(and(
        eq(orderNotificationOutbox.id, id),
        eq(orderNotificationOutbox.status, "sending"),
      )).returning({ id: orderNotificationOutbox.id });
      if (updated) return true;
      const [manual] = await database.update(manualOrderNotificationOutbox).set({ status: "sent", providerMessageId, lastErrorCode: null, sentAt: now, updatedAt: now }).where(and(eq(manualOrderNotificationOutbox.id, id), eq(manualOrderNotificationOutbox.status, "sending"))).returning({ id: manualOrderNotificationOutbox.id });
      return Boolean(manual);
    },

    async markFailed(id: string, errorCode: string, availableAt: Date, now: Date) {
      const [updated] = await database.update(orderNotificationOutbox).set({
        status: "failed",
        lastErrorCode: errorCode,
        availableAt,
        updatedAt: now,
      }).where(and(
        eq(orderNotificationOutbox.id, id),
        eq(orderNotificationOutbox.status, "sending"),
      )).returning({ id: orderNotificationOutbox.id });
      if (updated) return true;
      const [manual] = await database.update(manualOrderNotificationOutbox).set({ status: "failed", lastErrorCode: errorCode, availableAt, updatedAt: now }).where(and(eq(manualOrderNotificationOutbox.id, id), eq(manualOrderNotificationOutbox.status, "sending"))).returning({ id: manualOrderNotificationOutbox.id });
      return Boolean(manual);
    },
  });
}
