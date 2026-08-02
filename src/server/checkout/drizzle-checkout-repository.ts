import { and, eq, gt, inArray, notExists } from "drizzle-orm";
import type { getDatabase } from "@/server/db/client";
import { checkoutSessions, checkoutUploads } from "@/server/db/schema";
import type { CheckoutRepository } from "./checkout-repository";

type Database = ReturnType<typeof getDatabase>;

export function createDrizzleCheckoutRepository(
  database: Database,
): CheckoutRepository {
  return {
    async findActiveSessionByTokenDigest(tokenDigest, now) {
      const [session] = await database
        .select()
        .from(checkoutSessions)
        .where(
          and(
            eq(checkoutSessions.tokenDigest, tokenDigest),
            gt(checkoutSessions.expiresAt, now),
          ),
        )
        .limit(1);
      return session ?? null;
    },

    async createSession(input) {
      const [session] = await database
        .insert(checkoutSessions)
        .values(input)
        .returning();
      return session;
    },

    async deleteEmptySession(sessionId) {
      const deleted = await database
        .delete(checkoutSessions)
        .where(
          and(
            eq(checkoutSessions.id, sessionId),
            notExists(
              database
                .select({ id: checkoutUploads.id })
                .from(checkoutUploads)
                .where(eq(checkoutUploads.checkoutSessionId, sessionId)),
            ),
          ),
        )
        .returning({ id: checkoutSessions.id });
      return deleted.length > 0;
    },

    async createUpload(input) {
      const [upload] = await database
        .insert(checkoutUploads)
        .values(input)
        .returning();
      return upload;
    },

    async findOwnedUploadIds(sessionId, uploadIds) {
      if (uploadIds.length === 0) return [];
      const uploads = await database
        .select({ id: checkoutUploads.id })
        .from(checkoutUploads)
        .where(
          and(
            eq(checkoutUploads.checkoutSessionId, sessionId),
            inArray(checkoutUploads.id, uploadIds),
          ),
        );
      return uploads.map(({ id }) => id);
    },
  };
}
