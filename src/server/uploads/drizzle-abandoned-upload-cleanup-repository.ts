import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import type { getDatabase } from "@/server/db/client";
import { checkoutSessions, checkoutUploads, orders } from "@/server/db/schema";
import type { AbandonedUploadCleanupRepository } from "./abandoned-upload-cleanup";

type Database = ReturnType<typeof getDatabase>;

function eligibleSessions(database: Database, before: Date) {
  return database
    .select({ id: checkoutSessions.id })
    .from(checkoutSessions)
    .where(or(
      lt(checkoutSessions.expiresAt, before),
      and(
        isNotNull(checkoutSessions.completedAt),
        lt(checkoutSessions.completedAt, before),
      ),
    ));
}

const claimAvailable = () => or(
  isNull(checkoutUploads.cleanupClaimedAt),
  sql`${checkoutUploads.cleanupClaimedAt} < clock_timestamp() - interval '15 minutes'`,
);

export function createDrizzleAbandonedUploadCleanupRepository(
  database: Database,
): AbandonedUploadCleanupRepository {
  return Object.freeze({
    async listCandidates(before, limit) {
      return database
        .select({ id: checkoutUploads.id })
        .from(checkoutUploads)
        .where(and(
          isNull(checkoutUploads.claimedByOrderItemId),
          claimAvailable(),
          inArray(checkoutUploads.checkoutSessionId, eligibleSessions(database, before)),
        ))
        .orderBy(asc(checkoutUploads.createdAt), asc(checkoutUploads.id))
        .limit(limit);
    },

    async claim(id, before, claimedAt) {
      const [claimed] = await database
        .update(checkoutUploads)
        .set({ cleanupClaimedAt: claimedAt })
        .where(and(
          eq(checkoutUploads.id, id),
          isNull(checkoutUploads.claimedByOrderItemId),
          claimAvailable(),
          inArray(checkoutUploads.checkoutSessionId, eligibleSessions(database, before)),
        ))
        .returning({ id: checkoutUploads.id, storageKey: checkoutUploads.storageKey });
      return claimed ?? null;
    },

    async complete(id, claimedAt) {
      const deleted = await database
        .delete(checkoutUploads)
        .where(and(
          eq(checkoutUploads.id, id),
          eq(checkoutUploads.cleanupClaimedAt, claimedAt),
          isNull(checkoutUploads.claimedByOrderItemId),
        ))
        .returning({ id: checkoutUploads.id });
      return deleted.length === 1;
    },

    async release(id, claimedAt) {
      const released = await database
        .update(checkoutUploads)
        .set({ cleanupClaimedAt: null })
        .where(and(
          eq(checkoutUploads.id, id),
          eq(checkoutUploads.cleanupClaimedAt, claimedAt),
          isNull(checkoutUploads.claimedByOrderItemId),
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
