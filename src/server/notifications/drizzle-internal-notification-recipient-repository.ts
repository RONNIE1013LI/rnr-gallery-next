import { and, asc, eq, inArray } from "drizzle-orm";
import { buildAuditRecord } from "@/server/admin/audit-service";
import type { getDatabase } from "@/server/db/client";
import {
  adminAuditLogs,
  internalNotificationOutbox,
  internalNotificationRecipients,
  internalNotificationSubscriptions,
} from "@/server/db/schema";
import type { InternalNotificationTopic } from "./internal-notification-types";
import {
  InternalNotificationRecipientConflictError,
  InternalNotificationRecipientNotFoundError,
  type InternalNotificationRecipientRepository,
  type InternalNotificationRecipientView,
} from "./internal-notification-recipient-service";

type RootDatabase = ReturnType<typeof getDatabase>;
type TransactionDatabase = Parameters<Parameters<RootDatabase["transaction"]>[0]>[0];
type RecipientDatabase = RootDatabase | TransactionDatabase;
type RecipientRow = typeof internalNotificationRecipients.$inferSelect;

function safeView(row: RecipientRow, topics: readonly InternalNotificationTopic[]): InternalNotificationRecipientView {
  return Object.freeze({
    id: row.id,
    email: row.email,
    status: row.status,
    topics: Object.freeze([...topics]),
    createdAt: row.createdAt,
    verifiedAt: row.verifiedAt,
    verificationExpiresAt: row.verificationExpiresAt,
    disabledAt: row.disabledAt,
  });
}

async function loadView(database: RecipientDatabase, recipientId: string) {
  const [row] = await database.select().from(internalNotificationRecipients)
    .where(eq(internalNotificationRecipients.id, recipientId)).limit(1);
  if (!row) return null;
  const subscriptions = await database.select({ topic: internalNotificationSubscriptions.topic })
    .from(internalNotificationSubscriptions)
    .where(eq(internalNotificationSubscriptions.recipientId, recipientId))
    .orderBy(asc(internalNotificationSubscriptions.topic));
  return safeView(row, subscriptions.map(({ topic }) => topic));
}

async function replaceTopics(
  database: RecipientDatabase,
  recipientId: string,
  topics: readonly InternalNotificationTopic[],
  now: Date,
) {
  await database.delete(internalNotificationSubscriptions)
    .where(eq(internalNotificationSubscriptions.recipientId, recipientId));
  await database.insert(internalNotificationSubscriptions).values(
    topics.map((topic) => ({ recipientId, topic, createdAt: now, updatedAt: now })),
  );
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ("code" in error && error.code === "23505") return true;
  return "cause" in error && isUniqueViolation(error.cause);
}

async function priorAuditResource(
  database: RecipientDatabase,
  actorUserId: string,
  action: string,
  idempotencyKey: string,
) {
  const [audit] = await database.select({ resourceId: adminAuditLogs.resourceId })
    .from(adminAuditLogs)
    .where(and(
      eq(adminAuditLogs.actorUserId, actorUserId),
      eq(adminAuditLogs.action, action),
      eq(adminAuditLogs.idempotencyKey, idempotencyKey),
    )).limit(1);
  return audit?.resourceId ?? null;
}

export function createDrizzleInternalNotificationRecipientRepository(
  database: RootDatabase,
): InternalNotificationRecipientRepository {
  return Object.freeze({
    async list() {
      const rows = await database.select().from(internalNotificationRecipients)
        .orderBy(asc(internalNotificationRecipients.email));
      const subscriptions = await database.select({
        recipientId: internalNotificationSubscriptions.recipientId,
        topic: internalNotificationSubscriptions.topic,
      }).from(internalNotificationSubscriptions)
        .orderBy(asc(internalNotificationSubscriptions.topic));
      const topicsByRecipient = new Map<string, InternalNotificationTopic[]>();
      for (const subscription of subscriptions) {
        const topics = topicsByRecipient.get(subscription.recipientId) ?? [];
        topics.push(subscription.topic);
        topicsByRecipient.set(subscription.recipientId, topics);
      }
      return Object.freeze(rows.map((row) => safeView(row, topicsByRecipient.get(row.id) ?? [])));
    },

    async createPending(input: Parameters<InternalNotificationRecipientRepository["createPending"]>[0]) {
      try {
        return await database.transaction(async (transaction) => {
          if (await priorAuditResource(
            transaction,
            input.actor.userId,
            "internal_notification_recipient.created",
            input.idempotencyKey,
          )) {
            throw new InternalNotificationRecipientConflictError("Recipient request already processed");
          }

          const [existing] = await transaction.select().from(internalNotificationRecipients)
            .where(eq(internalNotificationRecipients.email, input.email))
            .for("update").limit(1);
          let row: RecipientRow;
          let beforeSummary: Record<string, unknown> | undefined;
          if (existing) {
            if (existing.status !== "disabled") {
              throw new InternalNotificationRecipientConflictError();
            }
            const before = await loadView(transaction, existing.id);
            beforeSummary = before
              ? { email: before.email, status: before.status, topics: before.topics }
              : undefined;
            [row] = await transaction.update(internalNotificationRecipients).set({
              status: "pending_verification",
              verificationTokenDigest: input.verificationTokenDigest,
              verificationIssuedAt: input.verificationIssuedAt,
              verificationExpiresAt: input.verificationExpiresAt,
              verifiedAt: null,
              disabledAt: null,
              disabledByUserId: null,
              updatedAt: input.verificationIssuedAt,
            }).where(eq(internalNotificationRecipients.id, existing.id)).returning();
          } else {
            [row] = await transaction.insert(internalNotificationRecipients).values({
              email: input.email,
              status: "pending_verification",
              verificationTokenDigest: input.verificationTokenDigest,
              verificationIssuedAt: input.verificationIssuedAt,
              verificationExpiresAt: input.verificationExpiresAt,
              createdByUserId: input.actor.userId,
              createdAt: input.verificationIssuedAt,
              updatedAt: input.verificationIssuedAt,
            }).returning();
          }
          await replaceTopics(transaction, row.id, input.topics, input.verificationIssuedAt);
          await transaction.insert(adminAuditLogs).values(buildAuditRecord({
            actorUserId: input.actor.userId,
            actorEmail: input.actor.email,
            action: "internal_notification_recipient.created",
            resourceType: "internal_notification_recipient",
            resourceId: row.id,
            ...(beforeSummary ? { beforeSummary } : {}),
            afterSummary: { email: row.email, status: row.status, topics: input.topics },
            result: "success",
            idempotencyKey: input.idempotencyKey,
          }));
          return (await loadView(transaction, row.id))!;
        });
      } catch (error) {
        if (error instanceof InternalNotificationRecipientConflictError) throw error;
        if (isUniqueViolation(error)) throw new InternalNotificationRecipientConflictError();
        throw error;
      }
    },

    async reissueVerification(input: Parameters<InternalNotificationRecipientRepository["reissueVerification"]>[0]) {
      return database.transaction(async (transaction) => {
        if (await priorAuditResource(
          transaction,
          input.actor.userId,
          "internal_notification_recipient.verification_reissued",
          input.idempotencyKey,
        )) {
          throw new InternalNotificationRecipientConflictError("Verification request already processed");
        }
        const [recipient] = await transaction.select().from(internalNotificationRecipients)
          .where(eq(internalNotificationRecipients.id, input.recipientId))
          .for("update").limit(1);
        if (!recipient || recipient.status !== "pending_verification") {
          throw new InternalNotificationRecipientNotFoundError();
        }
        const [updated] = await transaction.update(internalNotificationRecipients).set({
          verificationTokenDigest: input.verificationTokenDigest,
          verificationIssuedAt: input.verificationIssuedAt,
          verificationExpiresAt: input.verificationExpiresAt,
          updatedAt: input.verificationIssuedAt,
        }).where(eq(internalNotificationRecipients.id, recipient.id)).returning();
        await transaction.insert(adminAuditLogs).values(buildAuditRecord({
          actorUserId: input.actor.userId,
          actorEmail: input.actor.email,
          action: "internal_notification_recipient.verification_reissued",
          resourceType: "internal_notification_recipient",
          resourceId: recipient.id,
          beforeSummary: { email: recipient.email, status: recipient.status },
          afterSummary: { email: updated.email, status: updated.status },
          result: "success",
          idempotencyKey: input.idempotencyKey,
        }));
        return (await loadView(transaction, recipient.id))!;
      });
    },

    async verify(input: Parameters<InternalNotificationRecipientRepository["verify"]>[0]) {
      return database.transaction(async (transaction) => {
        const [recipient] = await transaction.select().from(internalNotificationRecipients)
          .where(and(
            eq(internalNotificationRecipients.verificationTokenDigest, input.verificationTokenDigest),
            eq(internalNotificationRecipients.status, "pending_verification"),
          )).for("update").limit(1);
        if (!recipient || !recipient.verificationExpiresAt || recipient.verificationExpiresAt <= input.now) {
          return null;
        }
        await transaction.update(internalNotificationRecipients).set({
          status: "active",
          verificationTokenDigest: null,
          verificationIssuedAt: null,
          verificationExpiresAt: null,
          verifiedAt: input.now,
          updatedAt: input.now,
        }).where(eq(internalNotificationRecipients.id, recipient.id));
        await transaction.insert(adminAuditLogs).values(buildAuditRecord({
          actorUserId: "system:notification-verification",
          actorEmail: recipient.email,
          action: "internal_notification_recipient.verified",
          resourceType: "internal_notification_recipient",
          resourceId: recipient.id,
          afterSummary: { email: recipient.email, status: "active" },
          requestSource: "public_verification_link",
          result: "success",
          idempotencyKey: `verified:${recipient.id}`,
        })).onConflictDoNothing();
        return loadView(transaction, recipient.id);
      });
    },

    async replaceSubscriptions(input: Parameters<InternalNotificationRecipientRepository["replaceSubscriptions"]>[0]) {
      return database.transaction(async (transaction) => {
        const replayId = await priorAuditResource(
          transaction,
          input.actor.userId,
          "internal_notification_recipient.subscriptions_updated",
          input.idempotencyKey,
        );
        if (replayId) {
          const replay = await loadView(transaction, replayId);
          if (replay) return replay;
        }
        const [recipient] = await transaction.select().from(internalNotificationRecipients)
          .where(eq(internalNotificationRecipients.id, input.recipientId))
          .for("update").limit(1);
        if (!recipient || recipient.status === "disabled") {
          throw new InternalNotificationRecipientNotFoundError();
        }
        const before = await loadView(transaction, recipient.id);
        await replaceTopics(transaction, recipient.id, input.topics, input.now);
        await transaction.update(internalNotificationRecipients).set({ updatedAt: input.now })
          .where(eq(internalNotificationRecipients.id, recipient.id));
        await transaction.insert(adminAuditLogs).values(buildAuditRecord({
          actorUserId: input.actor.userId,
          actorEmail: input.actor.email,
          action: "internal_notification_recipient.subscriptions_updated",
          resourceType: "internal_notification_recipient",
          resourceId: recipient.id,
          beforeSummary: { email: recipient.email, status: recipient.status, topics: before?.topics ?? [] },
          afterSummary: { email: recipient.email, status: recipient.status, topics: input.topics },
          result: "success",
          idempotencyKey: input.idempotencyKey,
        }));
        return (await loadView(transaction, recipient.id))!;
      });
    },

    async disable(input: Parameters<InternalNotificationRecipientRepository["disable"]>[0]) {
      return database.transaction(async (transaction) => {
        const replayId = await priorAuditResource(
          transaction,
          input.actor.userId,
          "internal_notification_recipient.disabled",
          input.idempotencyKey,
        );
        if (replayId) {
          const replay = await loadView(transaction, replayId);
          if (replay) return replay;
        }
        const [recipient] = await transaction.select().from(internalNotificationRecipients)
          .where(eq(internalNotificationRecipients.id, input.recipientId))
          .for("update").limit(1);
        if (!recipient) throw new InternalNotificationRecipientNotFoundError();
        if (recipient.status === "disabled") return (await loadView(transaction, recipient.id))!;
        const before = await loadView(transaction, recipient.id);
        await transaction.update(internalNotificationRecipients).set({
          status: "disabled",
          verificationTokenDigest: null,
          verificationIssuedAt: null,
          verificationExpiresAt: null,
          disabledByUserId: input.actor.userId,
          disabledAt: input.now,
          updatedAt: input.now,
        }).where(eq(internalNotificationRecipients.id, recipient.id));
        await transaction.update(internalNotificationOutbox).set({
          status: "cancelled",
          cancelledAt: input.now,
          cancellationReason: "recipient_disabled",
          updatedAt: input.now,
        }).where(and(
          eq(internalNotificationOutbox.recipientId, recipient.id),
          inArray(internalNotificationOutbox.status, ["pending", "failed"]),
        ));
        await transaction.insert(adminAuditLogs).values(buildAuditRecord({
          actorUserId: input.actor.userId,
          actorEmail: input.actor.email,
          action: "internal_notification_recipient.disabled",
          resourceType: "internal_notification_recipient",
          resourceId: recipient.id,
          beforeSummary: { email: recipient.email, status: recipient.status, topics: before?.topics ?? [] },
          afterSummary: { email: recipient.email, status: "disabled" },
          result: "success",
          idempotencyKey: input.idempotencyKey,
        }));
        return (await loadView(transaction, recipient.id))!;
      });
    },
  });
}
