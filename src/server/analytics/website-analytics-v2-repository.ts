import { and, asc, eq, gte, lte } from "drizzle-orm";
import { ANALYTICS_DIMENSION_SENTINELS } from "@/domain/analytics/website-analytics-v2";
import type { getDatabase } from "@/server/db/client";
import {
  websiteAnalyticsAttributionSnapshots,
  websiteAnalyticsConversions,
  websiteAnalyticsFinancialEvents,
  websiteAnalyticsReconciliationState,
  websiteAnalyticsSessions,
} from "@/server/db/schema";
import {
  resolveWebsiteAnalyticsAttribution,
  type WebsiteAnalyticsAttributionConversion,
  type WebsiteAnalyticsAttributionSnapshot,
} from "./website-analytics-attribution-v2";
import {
  buildWebsiteAnalyticsFinancialEvent,
  buildWebsiteAnalyticsInquiryFact,
  buildWebsiteAnalyticsOrderFact,
  type WebsiteAnalyticsConversionFact,
  type WebsiteAnalyticsFinancialEventInput,
  type WebsiteAnalyticsInquiryFactInput,
  type WebsiteAnalyticsOrderFactInput,
} from "./website-analytics-fact-builders";

type Database = ReturnType<typeof getDatabase>;
export type WebsiteAnalyticsV2Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = WebsiteAnalyticsV2Transaction;

type RecordResult = Readonly<{ created: boolean; factId: string }>;
type FinancialRecordResult = Readonly<{ created: boolean; eventId: string }>;

function validLookbackDays(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) return 90;
  return Math.min(value, 90);
}

function validLocalDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

function snapshotValues(conversionId: string, snapshot: WebsiteAnalyticsAttributionSnapshot) {
  return {
    conversionId,
    sessionId: snapshot.sessionId,
    attributionModel: snapshot.model,
    channel: snapshot.channel,
    source: snapshot.source,
    medium: snapshot.medium,
    campaign: snapshot.campaign,
    term: snapshot.term,
    content: snapshot.content,
    landingPath: snapshot.landingPath,
    externalReferrerOrigin: snapshot.externalReferrerOrigin,
    market: snapshot.market,
    countryCode: snapshot.countryCode,
    deviceCategory: snapshot.deviceCategory,
    consentQualifiedClickIds: snapshot.consentQualifiedClickIds,
    visitorReference: snapshot.visitorReference,
    conversionReference: snapshot.conversionReference,
    attributedAt: new Date(snapshot.attributedAt),
    rulesVersion: snapshot.rulesVersion,
  };
}

export function createWebsiteAnalyticsV2Repository(
  database: Database,
  options: Readonly<{ attributionLookbackDays?: number }> = {},
) {
  const lookbackDays = validLookbackDays(options.attributionLookbackDays);
  const databaseExecutor = database as unknown as Executor;

  async function inTransaction<T>(
    existing: WebsiteAnalyticsV2Transaction | undefined,
    action: (transaction: Executor) => Promise<T>,
  ): Promise<T> {
    return existing ? action(existing) : database.transaction(action);
  }

  async function resolveAttribution(
    input: WebsiteAnalyticsAttributionConversion,
    transaction?: WebsiteAnalyticsV2Transaction,
  ) {
    const executor = transaction ?? databaseExecutor;
    if (input.source === "manual" || !input.consentLinked || input.historical
      || !input.visitorDigest || !input.convertingSessionId) {
      return resolveWebsiteAnalyticsAttribution({ conversion: input, sessions: [], lookbackDays });
    }
    const cutoff = new Date(input.occurredAt.getTime() - lookbackDays * 86_400_000);
    const sessions = await executor.select({
      id: websiteAnalyticsSessions.id,
      visitorDigest: websiteAnalyticsSessions.visitorDigest,
      startedAt: websiteAnalyticsSessions.startedAt,
      channel: websiteAnalyticsSessions.channel,
      source: websiteAnalyticsSessions.source,
      medium: websiteAnalyticsSessions.medium,
      campaign: websiteAnalyticsSessions.utmCampaign,
      countryCode: websiteAnalyticsSessions.countryCode,
    }).from(websiteAnalyticsSessions).where(and(
      eq(websiteAnalyticsSessions.visitorDigest, input.visitorDigest),
      gte(websiteAnalyticsSessions.startedAt, cutoff),
      lte(websiteAnalyticsSessions.startedAt, input.occurredAt),
    )).orderBy(asc(websiteAnalyticsSessions.startedAt), asc(websiteAnalyticsSessions.id));
    return resolveWebsiteAnalyticsAttribution({
      conversion: input,
      sessions: sessions.map((session) => ({
        ...session,
        source: session.source ?? (session.channel === "direct"
          ? "direct"
          : ANALYTICS_DIMENSION_SENTINELS.unattributed),
        medium: session.medium ?? null,
        campaign: session.campaign ?? null,
        countryCode: session.countryCode ?? null,
      })),
      lookbackDays,
    });
  }

  async function markDirtyDate(localDate: string, transaction?: WebsiteAnalyticsV2Transaction) {
    if (!validLocalDate(localDate)) throw new Error("Invalid analytics local date");
    const executor = transaction ?? databaseExecutor;
    await executor.insert(websiteAnalyticsReconciliationState).values({
      stateType: "dirty_date",
      stateKey: localDate,
      localDate,
      status: "pending",
    }).onConflictDoUpdate({
      target: [
        websiteAnalyticsReconciliationState.stateType,
        websiteAnalyticsReconciliationState.stateKey,
      ],
      set: {
        localDate,
        status: "pending",
        startedAt: null,
        completedAt: null,
        lastErrorCode: null,
        updatedAt: new Date(),
      },
    });
  }

  async function recordConversion(
    fact: WebsiteAnalyticsConversionFact,
    transaction?: WebsiteAnalyticsV2Transaction,
  ): Promise<RecordResult> {
    return inTransaction(transaction, async (executor) => {
      const attribution = await resolveAttribution({
        occurredAt: fact.occurredAt,
        visitorDigest: fact.visitorDigest,
        convertingSessionId: fact.convertingSessionId,
        consentLinked: fact.consentLinked,
        source: fact.sourceType === "production_job" ? "manual" : "website",
        sourceReference: fact.sourceId,
        historical: fact.historical,
      }, executor);
      const [convertingSession] = attribution.convertingSessionId
        ? await executor.select({ isInternal: websiteAnalyticsSessions.isInternal })
          .from(websiteAnalyticsSessions)
          .where(eq(websiteAnalyticsSessions.id, attribution.convertingSessionId))
          .limit(1)
        : [];
      const [inserted] = await executor.insert(websiteAnalyticsConversions).values({
        ...fact,
        convertingSessionId: attribution.convertingSessionId,
        firstSessionId: attribution.firstSessionId,
        lastSessionId: attribution.lastSessionId,
        lastNonDirectSessionId: attribution.lastNonDirectSessionId,
        isInternal: fact.isInternal || convertingSession?.isInternal === true,
      }).onConflictDoNothing({
        target: [
          websiteAnalyticsConversions.conversionType,
          websiteAnalyticsConversions.sourceType,
          websiteAnalyticsConversions.sourceId,
        ],
      }).returning({
        id: websiteAnalyticsConversions.id,
        localDate: websiteAnalyticsConversions.localDate,
      });
      if (inserted) {
        await executor.insert(websiteAnalyticsAttributionSnapshots).values([
          snapshotValues(inserted.id, attribution.firstTouch),
          snapshotValues(inserted.id, attribution.lastTouch),
        ]).onConflictDoNothing({
          target: [
            websiteAnalyticsAttributionSnapshots.conversionId,
            websiteAnalyticsAttributionSnapshots.attributionModel,
          ],
        });
        await markDirtyDate(inserted.localDate, executor);
        return Object.freeze({ created: true, factId: inserted.id });
      }
      const [existing] = await executor.select({
        id: websiteAnalyticsConversions.id,
      }).from(websiteAnalyticsConversions).where(and(
        eq(websiteAnalyticsConversions.conversionType, fact.conversionType),
        eq(websiteAnalyticsConversions.sourceType, fact.sourceType),
        eq(websiteAnalyticsConversions.sourceId, fact.sourceId),
      )).limit(1);
      if (!existing) throw new Error("Analytics conversion conflict could not be resolved");
      return Object.freeze({ created: false, factId: existing.id });
    });
  }

  async function recordOrder(
    input: WebsiteAnalyticsOrderFactInput,
    transaction?: WebsiteAnalyticsV2Transaction,
  ): Promise<RecordResult> {
    return recordConversion(buildWebsiteAnalyticsOrderFact(input), transaction);
  }

  async function recordInquiry(
    input: WebsiteAnalyticsInquiryFactInput,
    transaction?: WebsiteAnalyticsV2Transaction,
  ): Promise<RecordResult> {
    return recordConversion(buildWebsiteAnalyticsInquiryFact(input), transaction);
  }

  async function recordFinancialEvent(
    input: WebsiteAnalyticsFinancialEventInput,
    transaction?: WebsiteAnalyticsV2Transaction,
  ): Promise<FinancialRecordResult> {
    const fact = buildWebsiteAnalyticsFinancialEvent(input);
    return inTransaction(transaction, async (executor) => {
      const [inserted] = await executor.insert(websiteAnalyticsFinancialEvents).values(fact)
        .onConflictDoNothing({
          target: [
            websiteAnalyticsFinancialEvents.sourceType,
            websiteAnalyticsFinancialEvents.sourceId,
            websiteAnalyticsFinancialEvents.eventType,
          ],
        }).returning({
          id: websiteAnalyticsFinancialEvents.id,
          localDate: websiteAnalyticsFinancialEvents.localDate,
        });
      if (inserted) {
        await markDirtyDate(inserted.localDate, executor);
        return Object.freeze({ created: true, eventId: inserted.id });
      }
      const [existing] = await executor.select({
        id: websiteAnalyticsFinancialEvents.id,
      }).from(websiteAnalyticsFinancialEvents).where(and(
        eq(websiteAnalyticsFinancialEvents.sourceType, fact.sourceType),
        eq(websiteAnalyticsFinancialEvents.sourceId, fact.sourceId),
        eq(websiteAnalyticsFinancialEvents.eventType, fact.eventType),
      )).limit(1);
      if (!existing) throw new Error("Analytics financial event conflict could not be resolved");
      return Object.freeze({ created: false, eventId: existing.id });
    });
  }

  return Object.freeze({
    recordOrder,
    recordInquiry,
    recordFinancialEvent,
    resolveAttribution,
    markDirtyDate,
  });
}
