import { between, desc, eq, sql } from "drizzle-orm";
import { WEBSITE_ANALYTICS_CHANNELS, type WebsiteAnalyticsChannel } from "@/domain/analytics/website-analytics";
import { getDatabase } from "@/server/db/client";
import {
  websiteAnalyticsPageviews,
  websiteAnalyticsSessions,
} from "@/server/db/schema";
import { websiteAnalyticsLocalDate } from "./website-local-date";

export const WEBSITE_ANALYTICS_PERIODS = ["today", "yesterday", "7d", "30d"] as const;
export type WebsiteAnalyticsPeriod = (typeof WEBSITE_ANALYTICS_PERIODS)[number];

type Database = ReturnType<typeof getDatabase>;

function shiftDate(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function websiteAnalyticsDateRange(period: WebsiteAnalyticsPeriod, now = new Date()) {
  const today = websiteAnalyticsLocalDate(now);
  const startDate = period === "yesterday"
    ? shiftDate(today, -1)
    : period === "7d"
      ? shiftDate(today, -6)
      : period === "30d"
        ? shiftDate(today, -29)
        : today;
  const endDate = period === "yesterday" ? startDate : today;
  return Object.freeze({ period, startDate, endDate });
}

export function createWebsiteAnalyticsDashboard(database: Database) {
  return Object.freeze({
    async load(period: WebsiteAnalyticsPeriod, now = new Date()) {
      const range = websiteAnalyticsDateRange(period, now);
      return database.transaction(async (transaction) => {
        const dateFilter = between(
          websiteAnalyticsPageviews.localDate,
          range.startDate,
          range.endDate,
        );
        const [metricsRow] = await transaction.select({
          visitors: sql<number>`count(distinct ${websiteAnalyticsSessions.visitorDigest})::int`,
          sessions: sql<number>`count(distinct ${websiteAnalyticsSessions.id})::int`,
          pageviews: sql<number>`count(${websiteAnalyticsPageviews.id})::int`,
        }).from(websiteAnalyticsPageviews)
          .innerJoin(
            websiteAnalyticsSessions,
            eq(websiteAnalyticsSessions.id, websiteAnalyticsPageviews.sessionId),
          )
          .where(dateFilter);

        const channelRows = await transaction.select({
          channel: websiteAnalyticsSessions.channel,
          visitors: sql<number>`count(distinct ${websiteAnalyticsSessions.visitorDigest})::int`,
          sessions: sql<number>`count(distinct ${websiteAnalyticsSessions.id})::int`,
          pageviews: sql<number>`count(${websiteAnalyticsPageviews.id})::int`,
        }).from(websiteAnalyticsPageviews)
          .innerJoin(
            websiteAnalyticsSessions,
            eq(websiteAnalyticsSessions.id, websiteAnalyticsPageviews.sessionId),
          )
          .where(dateFilter)
          .groupBy(websiteAnalyticsSessions.channel);

        const countryRows = await transaction.select({
          countryCode: websiteAnalyticsSessions.countryCode,
          visitors: sql<number>`count(distinct ${websiteAnalyticsSessions.visitorDigest})::int`,
          pageviews: sql<number>`count(${websiteAnalyticsPageviews.id})::int`,
        }).from(websiteAnalyticsPageviews)
          .innerJoin(
            websiteAnalyticsSessions,
            eq(websiteAnalyticsSessions.id, websiteAnalyticsPageviews.sessionId),
          )
          .where(dateFilter)
          .groupBy(websiteAnalyticsSessions.countryCode)
          .orderBy(desc(sql`count(${websiteAnalyticsPageviews.id})`));

        const topPages = await transaction.select({
          pathname: websiteAnalyticsPageviews.pathname,
          visitors: sql<number>`count(distinct ${websiteAnalyticsSessions.visitorDigest})::int`,
          pageviews: sql<number>`count(${websiteAnalyticsPageviews.id})::int`,
        }).from(websiteAnalyticsPageviews)
          .innerJoin(
            websiteAnalyticsSessions,
            eq(websiteAnalyticsSessions.id, websiteAnalyticsPageviews.sessionId),
          )
          .where(dateFilter)
          .groupBy(websiteAnalyticsPageviews.pathname)
          .orderBy(desc(sql`count(${websiteAnalyticsPageviews.id})`), websiteAnalyticsPageviews.pathname)
          .limit(20);

        const trend = await transaction.select({
          localDate: websiteAnalyticsPageviews.localDate,
          visitors: sql<number>`count(distinct ${websiteAnalyticsSessions.visitorDigest})::int`,
          pageviews: sql<number>`count(${websiteAnalyticsPageviews.id})::int`,
        }).from(websiteAnalyticsPageviews)
          .innerJoin(
            websiteAnalyticsSessions,
            eq(websiteAnalyticsSessions.id, websiteAnalyticsPageviews.sessionId),
          )
          .where(dateFilter)
          .groupBy(websiteAnalyticsPageviews.localDate)
          .orderBy(websiteAnalyticsPageviews.localDate);

        const channelsByName = new Map<WebsiteAnalyticsChannel, typeof channelRows[number]>(
          channelRows.map((row) => [row.channel, row]),
        );
        return Object.freeze({
          period,
          range,
          metrics: metricsRow ?? { visitors: 0, sessions: 0, pageviews: 0 },
          channels: WEBSITE_ANALYTICS_CHANNELS.map((channel) => channelsByName.get(channel) ?? {
            channel,
            visitors: 0,
            sessions: 0,
            pageviews: 0,
          }),
          countries: countryRows.map((row) => ({
            countryCode: row.countryCode ?? "Unknown",
            visitors: row.visitors,
            pageviews: row.pageviews,
          })),
          topPages,
          trend,
        });
      }, { isolationLevel: "repeatable read", accessMode: "read only" });
    },
  });
}

export function getWebsiteAnalyticsDashboard() {
  return createWebsiteAnalyticsDashboard(getDatabase());
}
