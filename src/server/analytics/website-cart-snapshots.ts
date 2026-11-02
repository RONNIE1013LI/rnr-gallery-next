import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { CartSnapshot } from "@/domain/analytics/cart-snapshot";
import { getDatabase } from "@/server/db/client";
import { websiteAnalyticsCartSnapshots, websiteAnalyticsSessions } from "@/server/db/schema";

type Database = ReturnType<typeof getDatabase>;
export type CartSnapshotInput = Readonly<{
  sessionId: string;
  visitorDigest: string;
  snapshot: CartSnapshot;
}>;

export function createCartSnapshotRecorder(database: Database) {
  return async function record(input: CartSnapshotInput): Promise<"saved" | "duplicate" | "unlinked" | "unavailable"> {
    const { sessionId, visitorDigest, snapshot } = input;
    const fingerprint = createHash("sha256").update(JSON.stringify({
      stage: snapshot.stage,
      currency: snapshot.currency,
      total: snapshot.totalInclGstCents,
      items: snapshot.items,
    })).digest("hex");
    return database.transaction(async (tx) => {
      const presence = await tx.execute(sql`select to_regclass('public.website_analytics_cart_snapshots') is not null as available`);
      if (presence.rows[0]?.available !== true) return "unavailable";
      const [session] = await tx.select({ id: websiteAnalyticsSessions.id })
        .from(websiteAnalyticsSessions)
        .where(and(eq(websiteAnalyticsSessions.id, sessionId),
          eq(websiteAnalyticsSessions.visitorDigest, visitorDigest)))
        .limit(1).for("update");
      if (!session) return "unlinked";
      const [latest] = await tx.select({ fingerprint: websiteAnalyticsCartSnapshots.fingerprint })
        .from(websiteAnalyticsCartSnapshots)
        .where(eq(websiteAnalyticsCartSnapshots.sessionId, sessionId))
        .orderBy(desc(websiteAnalyticsCartSnapshots.occurredAt), desc(websiteAnalyticsCartSnapshots.id))
        .limit(1);
      if (latest?.fingerprint === fingerprint) return "duplicate";
      // Per-session cap protects operational storage from excessive client updates.
      const [counter] = await tx.select({ count: sql<number>`count(*)::int` })
        .from(websiteAnalyticsCartSnapshots)
        .where(eq(websiteAnalyticsCartSnapshots.sessionId, sessionId));
      if ((counter?.count ?? 0) >= 500) return "duplicate";
      await tx.insert(websiteAnalyticsCartSnapshots).values({
        id: snapshot.eventId, sessionId, stage: snapshot.stage, occurredAt: sql`clock_timestamp()`,
        currency: snapshot.currency, totalInclGstCents: snapshot.totalInclGstCents,
        items: snapshot.items, fingerprint,
      }).onConflictDoNothing();
      return "saved";
    });
  };
}

export function recordWebsiteCartSnapshot(input: CartSnapshotInput) {
  return createCartSnapshotRecorder(getDatabase())(input);
}
