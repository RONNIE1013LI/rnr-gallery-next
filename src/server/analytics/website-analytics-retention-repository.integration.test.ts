import { createHash, randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, describe, expect, it } from "vitest";
import { websiteAnalyticsSessions } from "@/server/db/schema";
import { createWebsiteAnalyticsRepository } from "./website-analytics-repository";
import { createWebsiteAnalyticsRetentionRepository } from "./website-analytics-retention-repository";

const databaseUrl = process.env.TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
const database = databaseUrl ? drizzle(databaseUrl) : null;
const sessionIds: string[] = [];

async function pageview(sessionId: string, occurredAt: Date, eventId = randomUUID()) {
  sessionIds.push(sessionId);
  return createWebsiteAnalyticsRepository(database!).record({
    eventId,
    sessionId,
    visitorDigest: createHash("sha256").update(sessionId).digest("hex"),
    occurredAt,
    localDate: occurredAt.toISOString().slice(0, 10),
    pathname: "/shop",
    attribution: { channel: "direct", source: "direct", medium: null, utmCampaign: null, clickIdType: null },
    countryCode: null,
  });
}

suite("website analytics retention repository", () => {
  afterAll(async () => {
    if (database && sessionIds.length) {
      await database.delete(websiteAnalyticsSessions).where(inArray(websiteAnalyticsSessions.id, sessionIds));
    }
  });

  it("deletes only sessions whose complete pageview history is older than the cutoff", async () => {
    const expired = randomUUID();
    const exactCutoff = randomUUID();
    const recentPage = randomUUID();
    const cutoff = new Date("2000-08-29T10:00:00.000Z");
    await pageview(expired, new Date("2000-08-29T09:59:59.999Z"));
    await pageview(exactCutoff, cutoff);
    await pageview(recentPage, new Date("2000-08-01T00:00:00.000Z"));
    await pageview(recentPage, new Date("2000-08-30T00:00:00.000Z"));

    const deleted = await createWebsiteAnalyticsRetentionRepository(database!)
      .deleteBefore({ cutoff, limit: 500 });
    expect(deleted).toBe(1);

    const remaining = await database!.select({ id: websiteAnalyticsSessions.id })
      .from(websiteAnalyticsSessions)
      .where(inArray(websiteAnalyticsSessions.id, [expired, exactCutoff, recentPage]));
    expect(remaining.map((row) => row.id).sort()).toEqual([exactCutoff, recentPage].sort());
  });
});
