import { and, asc, eq, inArray, lt, lte, or, sql } from "drizzle-orm";
import type { getDatabase } from "@/server/db/client";
import {
  orders,
  paymentAttempts,
  paymentLedgerEntries,
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
    async repairMissingPaidNotifications(limit: number, now: Date) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        throw new Error("Notification repair limit must be an integer from 1 to 50");
      }
      return database.transaction(async (transaction) => {
        const customerRows = await transaction.execute<{ id: string }>(sql`
          with candidates as (
            select
              requests.id,
              coalesce(
                nullif(trim(attempts.payer_snapshot->>'email'), ''),
                nullif(trim(requests.customer_email), ''),
                nullif(trim(linked_orders.customer_email), '')
              ) as recipient_email,
              coalesce(
                nullif(trim(attempts.payer_snapshot->>'fullName'), ''),
                nullif(trim(requests.customer_name), ''),
                'Customer'
              ) as recipient_name
            from ${paymentRequests} as requests
            inner join ${paymentLedgerEntries} as ledger
              on ledger.payment_request_id = requests.id
              and ledger.entry_type = 'online_payment'
              and ledger.direction = 'credit'
            inner join ${paymentAttempts} as attempts
              on attempts.id = ledger.payment_attempt_id
              and attempts.status = 'paid'
            left join ${orders} as linked_orders on linked_orders.id = requests.order_id
            where requests.status = 'paid'
              and not exists (
                select 1 from ${paymentRequestNotificationOutbox} as notifications
                where notifications.event_key = 'payment-request-confirmed:' || requests.id
              )
            order by requests.paid_at asc, requests.id asc
            limit ${limit}
          )
          insert into ${paymentRequestNotificationOutbox} (
            event_key,
            kind,
            payment_request_id,
            recipient_name,
            recipient_email,
            status,
            attempts,
            available_at,
            created_at,
            updated_at
          )
          select
            'payment-request-confirmed:' || id,
            'payment_request_confirmed',
            id,
            recipient_name,
            recipient_email,
            'pending',
            0,
            ${now},
            ${now},
            ${now}
          from candidates
          where recipient_email is not null
          on conflict (event_key) do nothing
          returning id
        `);
        return customerRows.rows.length;
      });
    },

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
