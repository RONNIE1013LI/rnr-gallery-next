import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { websiteAnalyticsCartSnapshots as carts, websiteAnalyticsSessions as sessions } from "@/server/db/schema";
import { createCartSnapshotRecorder } from "./website-cart-snapshots";
import { createWebsiteAnalyticsRetentionRepository } from "./website-analytics-retention-repository";
const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 8 }) : null;
const db = pool ? drizzle(pool) : null;
const ids: string[] = [];
const digest = "a".repeat(64);
async function session() {
  const id = randomUUID(); ids.push(id);
  await db!.insert(sessions).values({ id, visitorDigest: digest, startedAt: new Date(), localDate: "2026-11-02", channel: "direct" });
  return id;
}
const snapshot = (eventId = randomUUID()) => ({ version: 1 as const, eventId, stage: "cart" as const, currency: "NZD" as const, totalInclGstCents: 0, items: [] });
afterAll(async () => { if (db && ids.length) await db.delete(sessions).where(inArray(sessions.id, ids)); await pool?.end(); });
(url ? describe : describe.skip)("cart snapshot storage boundaries", () => {
  it("serializes simultaneous identical snapshots and event retries", async () => {
    const sessionId = await session();
    const record = createCartSnapshotRecorder(db!);
    await Promise.all(Array.from({ length: 12 }, () => record({ sessionId, visitorDigest: digest, snapshot: snapshot() })));
    expect(await db!.select().from(carts).where(eq(carts.sessionId, sessionId))).toHaveLength(1);
    const s = snapshot();
    await record({ sessionId, visitorDigest: digest, snapshot: s });
    await record({ sessionId, visitorDigest: digest, snapshot: s });
    expect(await db!.select().from(carts).where(eq(carts.sessionId, sessionId))).toHaveLength(1);
  });
  it("refuses another visitor's signed session and missing pageview row", async () => {
    const record = createCartSnapshotRecorder(db!);
    expect(await record({ sessionId: await session(), visitorDigest: "b".repeat(64), snapshot: snapshot() })).toBe("unlinked");
    expect(await record({ sessionId: randomUUID(), visitorDigest: digest, snapshot: snapshot() })).toBe("unlinked");
  });
  it("expires snapshot rows at 90d even when its session is recent, and cascades session deletion", async () => {
    const sessionId = await session(); const record = createCartSnapshotRecorder(db!);
    await record({ sessionId, visitorDigest: digest, snapshot: snapshot() });
    await db!.update(carts).set({ occurredAt: new Date("2026-01-01Z") }).where(eq(carts.sessionId, sessionId));
    await createWebsiteAnalyticsRetentionRepository(db!).deleteCartSnapshotsBefore({ cutoff: new Date("2026-08-01Z"), limit: 500 });
    expect(await db!.select().from(carts).where(eq(carts.sessionId, sessionId))).toHaveLength(0);
    await record({ sessionId, visitorDigest: digest, snapshot: snapshot() });
    await db!.delete(sessions).where(eq(sessions.id, sessionId));
    expect(await db!.select().from(carts).where(eq(carts.sessionId, sessionId))).toHaveLength(0);
  });
  it("keeps the per-session cap under concurrent changes", async () => {
    const sessionId = await session();
    await db!.insert(carts).values(Array.from({ length: 499 }, (_, i) => ({ id: randomUUID(), sessionId, stage: "cart" as const, currency: "NZD" as const, totalInclGstCents: 0, items: [], fingerprint: String(i).padStart(64, "0") })));
    const record = createCartSnapshotRecorder(db!);
    await Promise.all(Array.from({ length: 8 }, (_, i) => record({ sessionId, visitorDigest: digest, snapshot: { ...snapshot(), stage: i % 2 ? "checkout" : "cart" } })));
    const [count] = await db!.select({ count: sql<number>`count(*)::int` }).from(carts).where(and(eq(carts.sessionId, sessionId)));
    expect(count?.count).toBe(500);
  });
});

(url ? it : it.skip)("fails closed before the additive schema exists", async () => {
  await db!.transaction(async tx => {
    await tx.execute(sql`alter table website_analytics_cart_snapshots rename to website_analytics_cart_snapshots_unavailable`);
    const record = createCartSnapshotRecorder(tx as unknown as NonNullable<typeof db>);
    expect(await record({ sessionId: randomUUID(), visitorDigest: digest, snapshot: snapshot() })).toBe("unavailable");
    await tx.execute(sql`alter table website_analytics_cart_snapshots_unavailable rename to website_analytics_cart_snapshots`);
  });
});
