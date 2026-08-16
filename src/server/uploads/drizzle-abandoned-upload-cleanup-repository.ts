import {
  and,
  asc,
  eq,
  isNotNull,
  isNull,
  lt,
  lte,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import type { getDatabase } from "@/server/db/client";
import { checkoutSessions, checkoutUploads, orders } from "@/server/db/schema";
import type { AbandonedUploadCleanupRepository } from "./abandoned-upload-cleanup";

type Database = ReturnType<typeof getDatabase>;

const claimAvailable = () => or(
  isNull(checkoutUploads.cleanupClaimedAt),
  sql`${checkoutUploads.cleanupClaimedAt} < clock_timestamp() - interval '15 minutes'`,
);

export function createDrizzleAbandonedUploadCleanupRepository(
  database: Database,
): AbandonedUploadCleanupRepository {
  const eligibleUploads = (before: Date) => and(
    lte(checkoutUploads.createdAt, before),
    isNull(checkoutUploads.purgedAt),
    isNotNull(checkoutUploads.storageKey),
    isNotNull(checkoutUploads.originalName),
    isNotNull(checkoutUploads.mediaType),
    isNotNull(checkoutUploads.sizeBytes),
    isNotNull(checkoutUploads.sha256),
    claimAvailable(),
  );

  return Object.freeze({
    async report(before) {
      const [result] = await database
        .select({
          eligible: sql<number>`count(*)::int`,
          eligibleBytes: sql<number>`coalesce(sum(${checkoutUploads.sizeBytes}), 0)::bigint`
            .mapWith(Number),
        })
        .from(checkoutUploads)
        .where(eligibleUploads(before));
      return result ?? { eligible: 0, eligibleBytes: 0 };
    },

    async listCandidates(before, limit) {
      return database
        .select({ id: checkoutUploads.id })
        .from(checkoutUploads)
        .where(eligibleUploads(before))
        .orderBy(asc(checkoutUploads.createdAt), asc(checkoutUploads.id))
        .limit(limit);
    },

    async claim(id, before, claimedAt) {
      const [claimed] = await database
        .update(checkoutUploads)
        .set({ cleanupClaimedAt: claimedAt })
        .where(and(
          eq(checkoutUploads.id, id),
          eligibleUploads(before),
        ))
        .returning({
          id: checkoutUploads.id,
          storageKey: checkoutUploads.storageKey,
          claimedByOrderItemId: checkoutUploads.claimedByOrderItemId,
        });
      if (!claimed?.storageKey) return null;
      return {
        id: claimed.id,
        storageKey: claimed.storageKey,
        bound: claimed.claimedByOrderItemId !== null,
      };
    },

    async complete(id, claimedAt, purgedAt) {
      const tombstoned = await database
        .update(checkoutUploads)
        .set({
          storageKey: null,
          originalName: null,
          mediaType: null,
          sizeBytes: null,
          sha256: null,
          cleanupClaimedAt: null,
          purgedAt,
        })
        .where(and(
          eq(checkoutUploads.id, id),
          eq(checkoutUploads.cleanupClaimedAt, claimedAt),
          isNotNull(checkoutUploads.claimedByOrderItemId),
          isNull(checkoutUploads.purgedAt),
        ))
        .returning({ id: checkoutUploads.id });
      if (tombstoned.length === 1) return "tombstoned";

      const deleted = await database
        .delete(checkoutUploads)
        .where(and(
          eq(checkoutUploads.id, id),
          eq(checkoutUploads.cleanupClaimedAt, claimedAt),
          isNull(checkoutUploads.claimedByOrderItemId),
          isNull(checkoutUploads.purgedAt),
        ))
        .returning({ id: checkoutUploads.id });
      return deleted.length === 1 ? "deleted" : null;
    },

    async release(id, claimedAt) {
      const released = await database
        .update(checkoutUploads)
        .set({ cleanupClaimedAt: null })
        .where(and(
          eq(checkoutUploads.id, id),
          eq(checkoutUploads.cleanupClaimedAt, claimedAt),
          isNull(checkoutUploads.purgedAt),
        ))
        .returning({ id: checkoutUploads.id });
      return released.length === 1;
    },

    async deleteExpiredEmptySessions(before) {
      const deleted = await database
        .delete(checkoutSessions)
        .where(and(
          lt(checkoutSessions.expiresAt, before),
          notExists(
            database.select({ id: checkoutUploads.id }).from(checkoutUploads)
              .where(eq(checkoutUploads.checkoutSessionId, checkoutSessions.id)),
          ),
          notExists(
            database.select({ id: orders.id }).from(orders)
              .where(eq(orders.checkoutSessionId, checkoutSessions.id)),
          ),
        ))
        .returning({ id: checkoutSessions.id });
      return deleted.length;
    },
  });
}
