import { eq } from "drizzle-orm";
import { getDatabase } from "@/server/db/client";
import { session, user } from "@/server/db/schema/auth";
import type { WebsiteChatNativeSessions } from "@/server/rnr-ai/website/chat-auth";

// Native auth operations only. Neither constructing this loader nor importing it
// connects to the database. The chat identity reader never receives this loader.
export function createNativeAuthSessionLoader(database = getDatabase): WebsiteChatNativeSessions {
  return {
    async list(userId) {
      // Deliberately no LIMIT: bulk revocation must include every cold session,
      // including rows beyond Better Auth's default 100-row adapter limit.
      return database().select({ token: session.token, expiresAt: session.expiresAt })
        .from(session).where(eq(session.userId, userId));
    },
    async get(token) {
      const [record] = await database().select({ session, user }).from(session)
        .innerJoin(user, eq(session.userId, user.id))
        .where(eq(session.token, token)).limit(1);
      return record ?? null;
    },
  };
}
