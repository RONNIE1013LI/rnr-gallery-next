import { and, asc, eq, inArray, lt, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { getDatabase } from "@/server/db/client";
import {
  internalNotificationOutbox,
  internalNotificationRecipients,
  internalNotificationSubscriptions,
} from "@/server/db/schema";
import type { InternalNotificationOutboxRepository } from "./internal-notification-service";
import { isCanonicalInternalNotificationAdminPath } from "./internal-notification-email";
import {
  INTERNAL_NOTIFICATION_TOPICS,
  type InternalNotificationResourceType,
  type InternalNotificationTopic,
} from "./internal-notification-types";

const INTERNAL_NOTIFICATION_RESOURCE_TYPES = Object.freeze([
  "production_job",
  "order",
  "payment_request",
  "proof_review",
] as const satisfies readonly InternalNotificationResourceType[]);

const payloadSchema = z.object({
  version: z.literal(1),
  adminPath: z.string().max(2048).refine(isCanonicalInternalNotificationAdminPath),
}).strict();

const eventSchema = z.object({
  topic: z.enum(INTERNAL_NOTIFICATION_TOPICS),
  sourceEventId: z.string().uuid().transform((value) => value.toLowerCase()),
  resourceType: z.enum(INTERNAL_NOTIFICATION_RESOURCE_TYPES),
  resourceId: z.string().uuid().transform((value) => value.toLowerCase()),
  resourceReference: z.string().trim().min(1).max(255),
  payload: payloadSchema,
  createdAt: z.date(),
}).strict();

export type InternalNotificationEvent = Readonly<{
  topic: InternalNotificationTopic;
  sourceEventId: string;
  resourceType: InternalNotificationResourceType;
  resourceId: string;
  resourceReference: string;
  payload: Readonly<{ version: 1; adminPath: string }>;
  createdAt: Date;
}>;

type Database = ReturnType<typeof getDatabase>;
export type NotificationTransaction =
  Parameters<Parameters<Database["transaction"]>[0]>[0];

function parseEvent(event: InternalNotificationEvent) {
  const parsed = eventSchema.safeParse(event);
  if (!parsed.success) {
    throw new Error("Invalid internal notification event");
  }
  return parsed.data;
}

function parsePayload(payload: unknown) {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("Invalid internal notification payload");
  }
  return Object.freeze(parsed.data);
}

export async function enqueueInternalNotifications(
  transaction: NotificationTransaction,
  event: InternalNotificationEvent,
): Promise<number> {
  const validEvent = parseEvent(event);
  const recipients = await transaction.select({
    id: internalNotificationRecipients.id,
    email: internalNotificationRecipients.email,
  }).from(internalNotificationRecipients)
    .innerJoin(
      internalNotificationSubscriptions,
      and(
        eq(
          internalNotificationSubscriptions.recipientId,
          internalNotificationRecipients.id,
        ),
        eq(internalNotificationSubscriptions.topic, validEvent.topic),
      ),
    )
    .where(eq(internalNotificationRecipients.status, "active"))
    .for("share", { of: internalNotificationRecipients });

  if (recipients.length === 0) return 0;

  const inserted = await transaction.insert(internalNotificationOutbox).values(
    recipients.map((recipient) => ({
      eventKey: `${validEvent.topic}:${validEvent.sourceEventId}:${recipient.id}`,
      topic: validEvent.topic,
      sourceEventId: validEvent.sourceEventId,
      resourceType: validEvent.resourceType,
      resourceId: validEvent.resourceId,
      resourceReference: validEvent.resourceReference,
      recipientId: recipient.id,
      recipientEmail: recipient.email,
      payload: validEvent.payload,
      status: "pending" as const,
      attempts: 0,
      availableAt: validEvent.createdAt,
      createdAt: validEvent.createdAt,
      updatedAt: validEvent.createdAt,
    })),
  ).onConflictDoNothing({
    target: internalNotificationOutbox.eventKey,
  }).returning({ id: internalNotificationOutbox.id });

  return inserted.length;
}

export function createDrizzleInternalNotificationOutboxRepository(
  database: Database,
): InternalNotificationOutboxRepository {
  return Object.freeze({
    async claimNext(now: Date) {
      const staleBefore = new Date(now.getTime() - 10 * 60_000);
      return database.transaction(async (transaction) => {
        const [row] = await transaction.select()
          .from(internalNotificationOutbox)
          .where(and(
            lte(internalNotificationOutbox.availableAt, now),
            or(
              inArray(internalNotificationOutbox.status, ["pending", "failed"]),
              and(
                eq(internalNotificationOutbox.status, "sending"),
                sql`${internalNotificationOutbox.lastAttemptAt} is not null`,
                lt(internalNotificationOutbox.lastAttemptAt, staleBefore),
              ),
            ),
          ))
          .orderBy(
            asc(internalNotificationOutbox.createdAt),
            asc(internalNotificationOutbox.id),
          )
          .for("update", { skipLocked: true })
          .limit(1);
        if (!row) return null;

        const payload = parsePayload(row.payload);
        const attempts = row.attempts + 1;
        const [updated] = await transaction.update(internalNotificationOutbox)
          .set({
            status: "sending",
            attempts,
            lastAttemptAt: now,
            updatedAt: now,
          })
          .where(and(
            eq(internalNotificationOutbox.id, row.id),
            eq(internalNotificationOutbox.attempts, row.attempts),
          ))
          .returning({ id: internalNotificationOutbox.id });
        if (!updated) return null;

        return Object.freeze({
          id: row.id,
          eventKey: row.eventKey,
          topic: row.topic,
          resourceReference: row.resourceReference,
          recipientId: row.recipientId,
          recipientEmail: row.recipientEmail,
          payload,
          attempts,
        });
      });
    },

    async isRecipientActive(recipientId: string) {
      const [recipient] = await database.select({
        id: internalNotificationRecipients.id,
      }).from(internalNotificationRecipients).where(and(
        eq(internalNotificationRecipients.id, recipientId),
        eq(internalNotificationRecipients.status, "active"),
      )).limit(1);
      return Boolean(recipient);
    },

    async markSent(id: string, providerMessageId: string, now: Date) {
      const [updated] = await database.update(internalNotificationOutbox).set({
        status: "sent",
        providerMessageId,
        lastErrorCode: null,
        sentAt: now,
        updatedAt: now,
      }).where(and(
        eq(internalNotificationOutbox.id, id),
        eq(internalNotificationOutbox.status, "sending"),
      )).returning({ id: internalNotificationOutbox.id });
      return Boolean(updated);
    },

    async markFailed(
      id: string,
      errorCode: string,
      availableAt: Date,
      now: Date,
    ) {
      const [updated] = await database.update(internalNotificationOutbox).set({
        status: "failed",
        lastErrorCode: errorCode,
        availableAt,
        updatedAt: now,
      }).where(and(
        eq(internalNotificationOutbox.id, id),
        eq(internalNotificationOutbox.status, "sending"),
      )).returning({ id: internalNotificationOutbox.id });
      return Boolean(updated);
    },

    async cancel(id: string, reason: string, now: Date) {
      const [updated] = await database.update(internalNotificationOutbox).set({
        status: "cancelled",
        cancelledAt: now,
        cancellationReason: reason,
        updatedAt: now,
      }).where(and(
        eq(internalNotificationOutbox.id, id),
        eq(internalNotificationOutbox.status, "sending"),
      )).returning({ id: internalNotificationOutbox.id });
      return Boolean(updated);
    },
  });
}
