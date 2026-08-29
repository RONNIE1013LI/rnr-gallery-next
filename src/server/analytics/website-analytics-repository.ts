import { eq } from "drizzle-orm";
import type { WebsiteAttribution } from "@/domain/analytics/website-attribution";
import { getDatabase } from "@/server/db/client";
import {
  websiteAnalyticsPageviews,
  websiteAnalyticsSessions,
} from "@/server/db/schema";

export type WebsiteAnalyticsRecord = Readonly<{
  eventId: string;
  sessionId: string;
  visitorDigest: string;
  occurredAt: Date;
  localDate: string;
  pathname: string;
  attribution: WebsiteAttribution;
  countryCode: string | null;
}>;

type Database = ReturnType<typeof getDatabase>;

export function createWebsiteAnalyticsRepository(database: Database) {
  return Object.freeze({
    async record(input: WebsiteAnalyticsRecord) {
      return database.transaction(async (transaction) => {
        const [session] = await transaction.insert(websiteAnalyticsSessions).values({
          id: input.sessionId,
          visitorDigest: input.visitorDigest,
          startedAt: input.occurredAt,
          localDate: input.localDate,
          channel: input.attribution.channel,
          source: input.attribution.source,
          medium: input.attribution.medium,
          utmCampaign: input.attribution.utmCampaign,
          clickIdType: input.attribution.clickIdType,
          countryCode: input.countryCode,
        }).onConflictDoNothing({ target: websiteAnalyticsSessions.id })
          .returning({ id: websiteAnalyticsSessions.id });

        const [pageview] = await transaction.insert(websiteAnalyticsPageviews).values({
          id: input.eventId,
          sessionId: input.sessionId,
          occurredAt: input.occurredAt,
          localDate: input.localDate,
          pathname: input.pathname,
        }).onConflictDoNothing({ target: websiteAnalyticsPageviews.id })
          .returning({ id: websiteAnalyticsPageviews.id });

        if (session && !pageview) {
          await transaction.delete(websiteAnalyticsSessions)
            .where(eq(websiteAnalyticsSessions.id, input.sessionId));
        }
        return Object.freeze({
          sessionCreated: Boolean(session && pageview),
          pageviewCreated: Boolean(pageview),
        });
      });
    },
  });
}

export function recordWebsiteAnalyticsPageview(input: WebsiteAnalyticsRecord) {
  return createWebsiteAnalyticsRepository(getDatabase()).record(input);
}
