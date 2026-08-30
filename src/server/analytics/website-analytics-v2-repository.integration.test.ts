import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  websiteAnalyticsAttributionSnapshots,
  websiteAnalyticsConversions,
  websiteAnalyticsFinancialEvents,
  websiteAnalyticsReconciliationState,
  websiteAnalyticsSessions,
} from "@/server/db/schema";
import { createWebsiteAnalyticsV2Repository } from "./website-analytics-v2-repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");
const testDatabaseIdentity = new URL(testDatabaseUrl);
if (!new Set(["127.0.0.1", "localhost"]).has(testDatabaseIdentity.hostname)
  || testDatabaseIdentity.pathname !== "/rnr_website_analytics_test") {
  throw new Error("The local rnr website analytics Test database is required");
}

const pool = new Pool({ connectionString: testDatabaseUrl });
const database = drizzle(pool);
const testRunId = randomUUID();
const sourcePrefix = `analytics-v2-task3:${testRunId}:`;
const sessionIds: string[] = [];
const dirtyDates = ["2097-01-01", "2097-01-02", "2097-01-03", "2097-01-04"];

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const sourceId = (value: string) => `${sourcePrefix}${value}`;

async function insertSession(input: Readonly<{
  id?: string;
  visitorDigest: string;
  startedAt: Date;
  channel: "google_ads" | "meta_ads" | "google_organic" | "direct" | "other";
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
}>) {
  const id = input.id ?? randomUUID();
  sessionIds.push(id);
  await database.insert(websiteAnalyticsSessions).values({
    id,
    visitorDigest: input.visitorDigest,
    startedAt: input.startedAt,
    localDate: input.startedAt.toISOString().slice(0, 10),
    channel: input.channel,
    source: input.source ?? null,
    medium: input.medium ?? null,
    utmCampaign: input.campaign ?? null,
  });
  return id;
}

afterAll(async () => {
  await database.delete(websiteAnalyticsFinancialEvents)
    .where(sql`${websiteAnalyticsFinancialEvents.sourceId} like ${`${sourcePrefix}%`}`);
  await database.delete(websiteAnalyticsConversions)
    .where(sql`${websiteAnalyticsConversions.sourceId} like ${`${sourcePrefix}%`}`);
  if (sessionIds.length > 0) {
    await database.delete(websiteAnalyticsSessions)
      .where(inArray(websiteAnalyticsSessions.id, sessionIds));
  }
  await database.delete(websiteAnalyticsReconciliationState)
    .where(and(
      eq(websiteAnalyticsReconciliationState.stateType, "dirty_date"),
      inArray(websiteAnalyticsReconciliationState.stateKey, dirtyDates),
    ));
  await pool.end();
});

describe("website analytics V2 repository", () => {
  it("keeps an order and its attribution snapshot immutable on a duplicate source ID", async () => {
    const repository = createWebsiteAnalyticsV2Repository(database, { attributionLookbackDays: 90 });
    const visitorDigest = digest(sourceId("immutable-visitor"));
    const sessionId = await insertSession({
      visitorDigest,
      startedAt: new Date("2096-12-31T22:00:00.000Z"),
      channel: "google_ads",
      source: "google",
      medium: "cpc",
      campaign: "original-campaign",
    });
    const input = {
      source: "website" as const,
      sourceId: sourceId("immutable-order"),
      occurredAt: new Date("2097-01-01T00:00:00.000Z"),
      market: "NZ" as const,
      currency: "NZD" as const,
      orderedAmountInclGstCents: 12_500,
      consentLinked: true,
      visitorDigest,
      convertingSessionId: sessionId,
    };

    const first = await repository.recordOrder(input);
    expect(first.created).toBe(true);
    const replacementSessionId = await insertSession({
      visitorDigest,
      startedAt: new Date("2097-01-02T00:00:00.000Z"),
      channel: "meta_ads",
      source: "facebook",
      medium: "paid-social",
      campaign: "replacement-campaign",
    });
    const duplicate = await repository.recordOrder({
      ...input,
      occurredAt: new Date("2097-01-03T00:00:00.000Z"),
      orderedAmountInclGstCents: 99_999,
      convertingSessionId: replacementSessionId,
    });
    expect(duplicate).toEqual({ created: false, factId: first.factId });

    const [conversion] = await database.select({
      id: websiteAnalyticsConversions.id,
      occurredAt: websiteAnalyticsConversions.occurredAt,
      localDate: websiteAnalyticsConversions.localDate,
      amount: websiteAnalyticsConversions.orderedAmountInclGstCents,
      firstSessionId: websiteAnalyticsConversions.firstSessionId,
    }).from(websiteAnalyticsConversions)
      .where(eq(websiteAnalyticsConversions.sourceId, input.sourceId));
    expect(conversion).toMatchObject({
      occurredAt: input.occurredAt,
      localDate: "2097-01-01",
      amount: 12_500,
      firstSessionId: sessionId,
    });
    expect(await database.select({
      model: websiteAnalyticsAttributionSnapshots.attributionModel,
      campaign: websiteAnalyticsAttributionSnapshots.campaign,
    }).from(websiteAnalyticsAttributionSnapshots)
      .where(eq(websiteAnalyticsAttributionSnapshots.conversionId, conversion!.id))
      .orderBy(asc(websiteAnalyticsAttributionSnapshots.attributionModel))).toEqual([
      { model: "first_touch", campaign: "original-campaign" },
      { model: "last_touch", campaign: "original-campaign" },
    ]);
  });

  it("uses the database unique constraint as the final concurrent idempotency boundary", async () => {
    const repository = createWebsiteAnalyticsV2Repository(database);
    const input = {
      source: "website" as const,
      sourceId: sourceId("concurrent-order"),
      occurredAt: new Date("2097-01-01T04:00:00.000Z"),
      market: "NZ" as const,
      currency: "NZD" as const,
      orderedAmountInclGstCents: 7_500,
      consentLinked: false,
    };
    const results = await Promise.all([
      repository.recordOrder(input),
      repository.recordOrder(input),
    ]);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.factId))).toHaveLength(1);
  });

  it("records one inquiry with nullable legacy links and no behavioral link without consent", async () => {
    const repository = createWebsiteAnalyticsV2Repository(database);
    const input = {
      sourceId: sourceId("legacy-inquiry"),
      occurredAt: new Date("2097-01-02T00:00:00.000Z"),
      consentLinked: false,
      visitorDigest: digest(sourceId("must-not-persist")),
      convertingSessionId: randomUUID(),
      historical: true,
    };

    expect(await repository.recordInquiry(input)).toMatchObject({ created: true });
    expect(await repository.recordInquiry(input)).toMatchObject({ created: false });

    const [conversion] = await database.select({
      id: websiteAnalyticsConversions.id,
      conversationId: websiteAnalyticsConversions.conversationId,
      visitorDigest: websiteAnalyticsConversions.visitorDigest,
      convertingSessionId: websiteAnalyticsConversions.convertingSessionId,
      firstSessionId: websiteAnalyticsConversions.firstSessionId,
      lastSessionId: websiteAnalyticsConversions.lastSessionId,
      historical: websiteAnalyticsConversions.historical,
      consentLinked: websiteAnalyticsConversions.consentLinked,
    }).from(websiteAnalyticsConversions)
      .where(eq(websiteAnalyticsConversions.sourceId, input.sourceId));
    expect(conversion).toMatchObject({
      conversationId: null,
      visitorDigest: null,
      convertingSessionId: null,
      firstSessionId: null,
      lastSessionId: null,
      historical: true,
      consentLinked: false,
    });
    expect(await database.select({
      channel: websiteAnalyticsAttributionSnapshots.channel,
      sessionId: websiteAnalyticsAttributionSnapshots.sessionId,
      visitorReference: websiteAnalyticsAttributionSnapshots.visitorReference,
      clickIds: websiteAnalyticsAttributionSnapshots.consentQualifiedClickIds,
    }).from(websiteAnalyticsAttributionSnapshots)
      .where(eq(websiteAnalyticsAttributionSnapshots.conversionId, conversion!.id)))
      .toEqual([
        { channel: "unattributed", sessionId: null, visitorReference: null, clickIds: null },
        { channel: "unattributed", sessionId: null, visitorReference: null, clickIds: null },
      ]);
  });

  it("resolves first, last, and last non-direct sessions inside the configured lookback", async () => {
    const repository = createWebsiteAnalyticsV2Repository(database, { attributionLookbackDays: 90 });
    const visitorDigest = digest(sourceId("lookup-visitor"));
    await insertSession({
      visitorDigest,
      startedAt: new Date("2096-09-01T00:00:00.000Z"),
      channel: "other",
      source: "expired.example",
    });
    const firstSessionId = await insertSession({
      visitorDigest,
      startedAt: new Date("2096-12-01T00:00:00.000Z"),
      channel: "google_organic",
      source: "google",
      medium: "organic",
      campaign: "first",
    });
    const lastNonDirectSessionId = await insertSession({
      visitorDigest,
      startedAt: new Date("2096-12-20T00:00:00.000Z"),
      channel: "meta_ads",
      source: "facebook",
      medium: "paid-social",
      campaign: "last-non-direct",
    });
    const convertingSessionId = await insertSession({
      visitorDigest,
      startedAt: new Date("2096-12-31T00:00:00.000Z"),
      channel: "direct",
      source: "direct",
    });

    const resolution = await repository.resolveAttribution({
      occurredAt: new Date("2097-01-01T00:00:00.000Z"),
      visitorDigest,
      convertingSessionId,
      consentLinked: true,
      source: "website",
      sourceReference: sourceId("lookup-conversion"),
    });
    expect({
      convertingSessionId: resolution.convertingSessionId,
      firstSessionId: resolution.firstSessionId,
      lastSessionId: resolution.lastSessionId,
      lastNonDirectSessionId: resolution.lastNonDirectSessionId,
      firstCampaign: resolution.firstTouch.campaign,
      lastCampaign: resolution.lastTouch.campaign,
    }).toEqual({
      convertingSessionId,
      firstSessionId,
      lastSessionId: convertingSessionId,
      lastNonDirectSessionId,
      firstCampaign: "first",
      lastCampaign: "last-non-direct",
    });
  });

  it("does not fabricate Direct when a consented legacy session has no source", async () => {
    const repository = createWebsiteAnalyticsV2Repository(database);
    const visitorDigest = digest(sourceId("null-source-visitor"));
    const convertingSessionId = await insertSession({
      visitorDigest,
      startedAt: new Date("2096-12-31T12:00:00.000Z"),
      channel: "meta_ads",
      source: null,
      campaign: "known-campaign",
    });

    const resolution = await repository.resolveAttribution({
      occurredAt: new Date("2097-01-01T00:00:00.000Z"),
      visitorDigest,
      convertingSessionId,
      consentLinked: true,
      source: "website",
      sourceReference: sourceId("null-source-conversion"),
    });
    expect({ channel: resolution.lastTouch.channel, source: resolution.lastTouch.source })
      .toEqual({ channel: "meta_ads", source: "Unattributed" });
  });

  it("stores two partial receipts, full and partial refunds, and duplicate webhooks exactly once per currency", async () => {
    const repository = createWebsiteAnalyticsV2Repository(database);
    const events = [
      { eventType: "receipt" as const, sourceType: "payment_ledger_entry" as const, sourceId: sourceId("receipt-1"), amountCents: 4_000, currency: "NZD" as const, occurredAt: new Date("2097-01-01T01:00:00.000Z") },
      { eventType: "receipt" as const, sourceType: "payment_ledger_entry" as const, sourceId: sourceId("receipt-2"), amountCents: 6_000, currency: "NZD" as const, occurredAt: new Date("2097-01-01T02:00:00.000Z") },
      { eventType: "refund" as const, sourceType: "payment_provider_event" as const, sourceId: sourceId("refund-full"), amountCents: 10_000, currency: "NZD" as const, occurredAt: new Date("2097-01-02T01:00:00.000Z") },
      { eventType: "refund" as const, sourceType: "payment_ledger_entry" as const, sourceId: sourceId("refund-partial"), amountCents: 2_500, currency: "AUD" as const, occurredAt: new Date("2097-01-02T02:00:00.000Z") },
    ];
    for (const event of events) expect(await repository.recordFinancialEvent(event)).toMatchObject({ created: true });
    expect(await repository.recordFinancialEvent(events[2]!)).toMatchObject({ created: false });

    const rows = await database.select({
      eventType: websiteAnalyticsFinancialEvents.eventType,
      amountCents: websiteAnalyticsFinancialEvents.amountCents,
      currency: websiteAnalyticsFinancialEvents.currency,
    }).from(websiteAnalyticsFinancialEvents)
      .where(sql`${websiteAnalyticsFinancialEvents.sourceId} like ${`${sourcePrefix}%`}`)
      .orderBy(asc(websiteAnalyticsFinancialEvents.sourceId));
    expect(rows).toEqual(expect.arrayContaining([
      { eventType: "receipt", amountCents: 4_000, currency: "NZD" },
      { eventType: "receipt", amountCents: 6_000, currency: "NZD" },
      { eventType: "refund", amountCents: 10_000, currency: "NZD" },
      { eventType: "refund", amountCents: 2_500, currency: "AUD" },
    ]));
    expect(rows).toHaveLength(4);
    expect(await database.select({ stateKey: websiteAnalyticsReconciliationState.stateKey })
      .from(websiteAnalyticsReconciliationState).where(and(
        eq(websiteAnalyticsReconciliationState.stateType, "dirty_date"),
        inArray(websiteAnalyticsReconciliationState.stateKey, ["2097-01-01", "2097-01-02"]),
      )).orderBy(asc(websiteAnalyticsReconciliationState.stateKey))).toEqual([
      { stateKey: "2097-01-01" },
      { stateKey: "2097-01-02" },
    ]);
  });

  it("upserts each dirty Auckland date idempotently and reopens completed work", async () => {
    const repository = createWebsiteAnalyticsV2Repository(database);
    await repository.markDirtyDate("2097-01-04");
    await repository.markDirtyDate("2097-01-04");
    await database.update(websiteAnalyticsReconciliationState).set({
      status: "completed",
      startedAt: new Date("2097-01-05T00:00:00.000Z"),
      completedAt: new Date("2097-01-05T00:01:00.000Z"),
    }).where(and(
      eq(websiteAnalyticsReconciliationState.stateType, "dirty_date"),
      eq(websiteAnalyticsReconciliationState.stateKey, "2097-01-04"),
    ));
    await repository.markDirtyDate("2097-01-04");

    expect(await database.select({
      localDate: websiteAnalyticsReconciliationState.localDate,
      status: websiteAnalyticsReconciliationState.status,
      startedAt: websiteAnalyticsReconciliationState.startedAt,
      completedAt: websiteAnalyticsReconciliationState.completedAt,
    }).from(websiteAnalyticsReconciliationState).where(and(
      eq(websiteAnalyticsReconciliationState.stateType, "dirty_date"),
      eq(websiteAnalyticsReconciliationState.stateKey, "2097-01-04"),
    ))).toEqual([{
      localDate: "2097-01-04",
      status: "pending",
      startedAt: null,
      completedAt: null,
    }]);
  });

  it("accepts an existing transaction and does not escape its rollback", async () => {
    const repository = createWebsiteAnalyticsV2Repository(database);
    const transactionalSource = sourceId("rolled-back-inquiry");
    await expect(database.transaction(async (transaction) => {
      await repository.recordInquiry({
        sourceId: transactionalSource,
        occurredAt: new Date("2097-01-03T00:00:00.000Z"),
        consentLinked: false,
      }, transaction);
      throw new Error("force rollback");
    })).rejects.toThrow("force rollback");
    expect(await database.select({ id: websiteAnalyticsConversions.id })
      .from(websiteAnalyticsConversions)
      .where(eq(websiteAnalyticsConversions.sourceId, transactionalSource))).toEqual([]);
  });
});
