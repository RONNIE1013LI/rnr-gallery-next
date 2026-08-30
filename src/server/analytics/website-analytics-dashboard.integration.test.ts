import { createHash, randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, describe, expect, it } from "vitest";
import { websiteAnalyticsSessions } from "@/server/db/schema";
import { createWebsiteAnalyticsRepository } from "./website-analytics-repository";
import { createWebsiteAnalyticsDashboard } from "./website-analytics-dashboard";

const databaseUrl = process.env.TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
const database = databaseUrl ? drizzle(databaseUrl) : null;
const sessionIds: string[] = [];

function record(input: Readonly<{
  sessionId: string;
  visitor: string;
  eventId: string;
  pathname: string;
  channel: "google_ads" | "meta_ads" | "direct";
  countryCode: string | null;
  occurredAt: Date;
  localDate: string;
  isInternal?: boolean;
}>) {
  sessionIds.push(input.sessionId);
  return createWebsiteAnalyticsRepository(database!).record({
    eventId: input.eventId,
    sessionId: input.sessionId,
    visitorDigest: createHash("sha256").update(input.visitor).digest("hex"),
    occurredAt: input.occurredAt,
    localDate: input.localDate,
    pathname: input.pathname,
    attribution: {
      channel: input.channel,
      source: input.channel === "direct" ? "direct" : input.channel.replace("_ads", ""),
      medium: input.channel === "direct" ? null : "paid_click",
      utmCampaign: null,
      clickIdType: input.channel === "google_ads" ? "gclid" : input.channel === "meta_ads" ? "fbclid" : null,
    },
    countryCode: input.countryCode,
    isInternal: input.isInternal === true,
  });
}

suite("website analytics dashboard queries", () => {
  afterAll(async () => {
    if (database && sessionIds.length) {
      await database.delete(websiteAnalyticsSessions).where(inArray(websiteAnalyticsSessions.id, sessionIds));
    }
  });

  it("reports correct visitors, sessions, views, channels, countries, and pages", async () => {
    const visitorA = randomUUID();
    const visitorB = randomUUID();
    const googleSession = randomUUID();
    const metaSession = randomUUID();
    const internalSession = randomUUID();
    await record({ sessionId: googleSession, visitor: visitorA, eventId: randomUUID(), pathname: "/shop", channel: "google_ads", countryCode: "NZ", occurredAt: new Date("2040-08-29T01:00:00Z"), localDate: "2040-08-29" });
    await record({ sessionId: googleSession, visitor: visitorA, eventId: randomUUID(), pathname: "/products/photo-print-canvas", channel: "google_ads", countryCode: "NZ", occurredAt: new Date("2040-08-29T01:01:00Z"), localDate: "2040-08-29" });
    await record({ sessionId: metaSession, visitor: visitorB, eventId: randomUUID(), pathname: "/shop", channel: "meta_ads", countryCode: "AU", occurredAt: new Date("2040-08-29T02:00:00Z"), localDate: "2040-08-29" });
    await record({ sessionId: internalSession, visitor: randomUUID(), eventId: randomUUID(), pathname: "/admin-test", channel: "direct", countryCode: "NZ", occurredAt: new Date("2040-08-29T03:00:00Z"), localDate: "2040-08-29", isInternal: true });

    const result = await createWebsiteAnalyticsDashboard(database!).load("today", new Date("2040-08-29T05:00:00Z"));

    expect(result.metrics).toEqual({ visitors: 2, sessions: 2, pageviews: 3 });
    expect(result.channels.find((row) => row.channel === "google_ads"))
      .toEqual(expect.objectContaining({ visitors: 1, sessions: 1, pageviews: 2 }));
    expect(result.channels.find((row) => row.channel === "meta_ads"))
      .toEqual(expect.objectContaining({ visitors: 1, sessions: 1, pageviews: 1 }));
    expect(result.countries).toEqual(expect.arrayContaining([
      { countryCode: "NZ", visitors: 1, pageviews: 2 },
      { countryCode: "AU", visitors: 1, pageviews: 1 },
    ]));
    expect(result.topPages[0]).toEqual({ pathname: "/shop", visitors: 2, pageviews: 2 });

    const withInternal = await createWebsiteAnalyticsDashboard(database!).load(
      "today",
      new Date("2040-08-29T05:00:00Z"),
      true,
    );
    expect(withInternal.metrics).toEqual({ visitors: 3, sessions: 3, pageviews: 4 });
    expect(withInternal.channels.find((row) => row.channel === "direct"))
      .toEqual(expect.objectContaining({ visitors: 1, sessions: 1, pageviews: 1 }));
  });
});
