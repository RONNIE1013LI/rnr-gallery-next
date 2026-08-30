import { createHash, randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, describe, expect, it } from "vitest";
import {
  websiteAnalyticsPageviews,
  websiteAnalyticsSessions,
} from "@/server/db/schema";
import { createWebsiteAnalyticsRepository } from "./website-analytics-repository";

const databaseUrl = process.env.TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
const database = databaseUrl ? drizzle(databaseUrl) : null;
const sessionIds: string[] = [];

function input(overrides: Partial<Parameters<ReturnType<typeof createWebsiteAnalyticsRepository>["record"]>[0]> = {}) {
  const sessionId = randomUUID();
  sessionIds.push(sessionId);
  return {
    eventId: randomUUID(),
    sessionId,
    visitorDigest: createHash("sha256").update(randomUUID()).digest("hex"),
    occurredAt: new Date("2026-08-29T10:00:00.000Z"),
    localDate: "2026-08-29",
    pathname: "/products/photo-print-canvas",
    attribution: {
      channel: "direct" as const,
      source: "direct",
      medium: null,
      utmCampaign: null,
      clickIdType: null,
    },
    countryCode: "NZ",
    isInternal: false,
    ...overrides,
  };
}

suite("website analytics repository", () => {
  afterAll(async () => {
    if (!database || sessionIds.length === 0) return;
    await database.delete(websiteAnalyticsSessions).where(inArray(websiteAnalyticsSessions.id, sessionIds));
  });

  it("records one session and one pageview for duplicate delivery", async () => {
    const repository = createWebsiteAnalyticsRepository(database!);
    const value = input();

    expect(await repository.record(value)).toEqual({ sessionCreated: true, pageviewCreated: true });
    expect(await repository.record(value)).toEqual({ sessionCreated: false, pageviewCreated: false });

    const [counts] = await database!.select({
      sessions: sql<number>`count(distinct ${websiteAnalyticsSessions.id})::int`,
      pageviews: sql<number>`count(distinct ${websiteAnalyticsPageviews.id})::int`,
    }).from(websiteAnalyticsSessions)
      .leftJoin(websiteAnalyticsPageviews, eq(websiteAnalyticsPageviews.sessionId, websiteAnalyticsSessions.id))
      .where(eq(websiteAnalyticsSessions.id, value.sessionId));
    expect(counts).toEqual({ sessions: 1, pageviews: 1 });
  });

  it("does not leave an orphan session when two new sessions race on one event ID", async () => {
    const repository = createWebsiteAnalyticsRepository(database!);
    const eventId = randomUUID();
    const first = input({ eventId });
    const second = input({ eventId });

    const results = await Promise.all([repository.record(first), repository.record(second)]);
    expect(results.filter((result) => result.pageviewCreated)).toHaveLength(1);

    const [counts] = await database!.select({
      sessions: sql<number>`count(*)::int`,
    }).from(websiteAnalyticsSessions)
      .where(inArray(websiteAnalyticsSessions.id, [first.sessionId, second.sessionId]));
    expect(counts.sessions).toBe(1);
  });

  it("persists the trusted internal flag on the session without dropping the raw pageview", async () => {
    const repository = createWebsiteAnalyticsRepository(database!);
    const value = input({ isInternal: true });
    expect(await repository.record(value)).toEqual({ sessionCreated: true, pageviewCreated: true });

    const [stored] = await database!.select({
      isInternal: websiteAnalyticsSessions.isInternal,
      pageviews: sql<number>`count(${websiteAnalyticsPageviews.id})::int`,
    }).from(websiteAnalyticsSessions)
      .innerJoin(websiteAnalyticsPageviews,
        eq(websiteAnalyticsPageviews.sessionId, websiteAnalyticsSessions.id))
      .where(eq(websiteAnalyticsSessions.id, value.sessionId))
      .groupBy(websiteAnalyticsSessions.isInternal);
    expect(stored).toEqual({ isInternal: true, pageviews: 1 });
  });
});
