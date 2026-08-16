import { and, asc, eq, inArray, lt, lte, or, sql } from "drizzle-orm";
import type { getDatabase } from "@/server/db/client";
import {
  orderAddresses,
  orderNotificationOutbox,
  orders,
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
        if (!row) return null;
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
      return Boolean(updated);
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
      return Boolean(updated);
    },
  });
}
