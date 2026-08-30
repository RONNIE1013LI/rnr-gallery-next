import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { ANALYTICS_DIMENSION_SENTINELS } from "@/domain/analytics/website-analytics-v2";
import {
  customerServiceConversations,
  customerServiceMessages,
  websiteAnalyticsConversions,
  websiteAnalyticsDailyAggregates,
  websiteAnalyticsFinancialEvents,
  websiteAnalyticsPageviews,
  websiteAnalyticsReconciliationState,
  websiteAnalyticsSessions,
} from "@/server/db/schema";
import { isDedicatedTestDatabase } from "@/server/db/test-database-safety";
import { createWebsiteAnalyticsV2Reconciliation } from "./website-analytics-v2-reconciliation";
import { createWebsiteAnalyticsV2Repository } from "./website-analytics-v2-repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");
if (!isDedicatedTestDatabase(testDatabaseUrl, process.env.DATABASE_URL)) {
  throw new Error("A dedicated website analytics Test database is required");
}

const pool = new Pool({ connectionString: testDatabaseUrl, max: 6 });
const database = drizzle(pool);
const runId = randomUUID();
const prefix = `analytics-v2-task5-reconcile:${runId}:`;
const localDates = [
  "2297-09-30", "2297-10-01", "2297-10-02", "2297-10-03",
  "2297-11-10", "2297-11-11", "2297-11-12", "2297-11-13",
  "2297-11-30", "2297-12-01", "2297-12-02",
];
const sessionIds: string[] = [];
const conversationIds: string[] = [];
const messageIds: string[] = [];

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

async function websiteOrder(input: Readonly<{
  sourceId: string;
  occurredAt: Date;
  amountCents: number;
  market: "NZ" | "AU";
}>) {
  const repository = createWebsiteAnalyticsV2Repository(database);
  return repository.recordOrder({
    source: "website",
    sourceId: input.sourceId,
    occurredAt: input.occurredAt,
    market: input.market,
    currency: input.market === "AU" ? "AUD" : "NZD",
    orderedAmountInclGstCents: input.amountCents,
    historical: true,
    consentLinked: false,
  });
}

async function financial(input: Readonly<{
  conversionId: string;
  sourceId: string;
  occurredAt: Date;
  amountCents: number;
  currency: "NZD" | "AUD";
  eventType: "receipt" | "refund" | "reversal";
}>) {
  return createWebsiteAnalyticsV2Repository(database).recordFinancialEvent({
    conversionId: input.conversionId,
    sourceType: "payment_provider_event",
    sourceId: input.sourceId,
    occurredAt: input.occurredAt,
    amountCents: input.amountCents,
    currency: input.currency,
    eventType: input.eventType,
    historical: true,
  });
}

async function websiteSession() {
  const id = randomUUID();
  sessionIds.push(id);
  await database.insert(websiteAnalyticsSessions).values({
    id,
    visitorDigest: digest(`${prefix}visitor`),
    startedAt: new Date("2297-09-30T00:10:00.000Z"),
    localDate: "2297-09-30",
    channel: "google_ads",
    source: "google",
    medium: "cpc",
    utmCampaign: "task-5",
  });
  await database.insert(websiteAnalyticsPageviews).values([
    {
      id: randomUUID(),
      sessionId: id,
      occurredAt: new Date("2297-09-30T00:10:00.000Z"),
      localDate: "2297-09-30",
      pathname: "/shop",
    },
    {
      id: randomUUID(),
      sessionId: id,
      occurredAt: new Date("2297-09-30T00:11:00.000Z"),
      localDate: "2297-09-30",
      pathname: "/cart",
    },
  ]);
}

async function trafficSession(input: Readonly<{
  visitorKey: string;
  startedAt: Date;
  sessionLocalDate: string;
  pageviewLocalDate: string;
  channel: "google_ads" | "meta_ads" | "direct" | "other";
  source: string;
  medium: string | null;
  utmCampaign?: string | null;
}>) {
  const id = randomUUID();
  sessionIds.push(id);
  await database.insert(websiteAnalyticsSessions).values({
    id,
    visitorDigest: digest(`${prefix}visitor:${input.visitorKey}`),
    startedAt: input.startedAt,
    localDate: input.sessionLocalDate,
    channel: input.channel,
    source: input.source,
    medium: input.medium,
    utmCampaign: input.utmCampaign === undefined ? `${prefix}multi-channel` : input.utmCampaign,
  });
  await database.insert(websiteAnalyticsPageviews).values({
    id: randomUUID(),
    sessionId: id,
    occurredAt: new Date(input.startedAt.getTime() + 60_000),
    localDate: input.pageviewLocalDate,
    pathname: "/analytics-task-5",
  });
}

async function sourceInquiry(occurredAt: Date) {
  const conversationId = randomUUID();
  const messageId = randomUUID();
  conversationIds.push(conversationId);
  messageIds.push(messageId);
  await database.insert(customerServiceConversations).values({
    id: conversationId,
    channel: "website",
    externalKeyHash: digest(`${prefix}conversation:${conversationId}`),
    createdAt: occurredAt,
  });
  await database.insert(customerServiceMessages).values({
    id: messageId,
    conversationId,
    channel: "website",
    externalMessageKeyHash: digest(`${prefix}message:${messageId}`),
    body: "Task 5 reconciliation inquiry",
    receivedAt: occurredAt,
    createdAt: occurredAt,
  });
  return conversationId;
}

afterAll(async () => {
  await database.delete(websiteAnalyticsDailyAggregates)
    .where(inArray(websiteAnalyticsDailyAggregates.localDate, localDates));
  await database.delete(websiteAnalyticsFinancialEvents)
    .where(sql`${websiteAnalyticsFinancialEvents.sourceId} like ${`${prefix}%`}`);
  await database.delete(websiteAnalyticsConversions)
    .where(sql`${websiteAnalyticsConversions.sourceId} like ${`${prefix}%`}`);
  if (conversationIds.length > 0) {
    await database.delete(websiteAnalyticsConversions)
      .where(inArray(websiteAnalyticsConversions.sourceId, conversationIds));
  }
  await database.delete(websiteAnalyticsReconciliationState).where(orState());
  if (sessionIds.length > 0) {
    await database.delete(websiteAnalyticsSessions)
      .where(inArray(websiteAnalyticsSessions.id, sessionIds));
  }
  if (messageIds.length > 0) {
    await database.delete(customerServiceMessages).where(inArray(customerServiceMessages.id, messageIds));
  }
  if (conversationIds.length > 0) {
    await database.delete(customerServiceConversations)
      .where(inArray(customerServiceConversations.id, conversationIds));
  }
  await pool.end();
});

function orState() {
  return sql`(${websiteAnalyticsReconciliationState.stateType} = 'dirty_date'
      and ${websiteAnalyticsReconciliationState.stateKey} in (${sql.join(localDates.map((date) => sql`${date}`), sql`, `)}))
    or ${websiteAnalyticsReconciliationState.stateKey} like ${`${prefix}%`}`;
}

describe("website analytics V2 reconciliation", () => {
  it("rebuilds raw facts idempotently with Auckland dates and separate NZD/AUD rows", async () => {
    await websiteSession();
    const nz = await websiteOrder({
      sourceId: `${prefix}nz-order`,
      occurredAt: new Date("2297-09-30T01:00:00.000Z"),
      amountCents: 10_000,
      market: "NZ",
    });
    const au = await websiteOrder({
      sourceId: `${prefix}au-order`,
      occurredAt: new Date("2297-09-30T02:00:00.000Z"),
      amountCents: 20_000,
      market: "AU",
    });
    await financial({
      conversionId: nz.factId,
      sourceId: `${prefix}nz-receipt`,
      occurredAt: new Date("2297-09-30T03:00:00.000Z"),
      amountCents: 10_000,
      currency: "NZD",
      eventType: "receipt",
    });
    await financial({
      conversionId: au.factId,
      sourceId: `${prefix}au-receipt`,
      occurredAt: new Date("2297-09-30T04:00:00.000Z"),
      amountCents: 20_000,
      currency: "AUD",
      eventType: "receipt",
    });
    const reconciliation = createWebsiteAnalyticsV2Reconciliation(database);
    const first = await reconciliation.rebuildDirtyDate("2297-09-30");
    expect(first).toMatchObject({ rebuilt: 1, busy: 0, failed: 0 });
    const raw = await reconciliation.readRawDailyRows("2297-09-30");
    const aggregate = await reconciliation.readAggregateDailyRows("2297-09-30");
    expect(aggregate).toEqual(raw);
    expect(raw.reduce((sum, row) => sum + row.paidOrders, 0)).toBe(0);
    const nzd = aggregate.filter((row) => row.currency === "NZD"
      && row.scope === "website" && row.attributionModel === "last_touch");
    const aud = aggregate.filter((row) => row.currency === "AUD"
      && row.scope === "website" && row.attributionModel === "last_touch");
    expect(nzd.reduce((sum, row) => sum + row.orderedRevenueCents, 0)).toBe(10_000);
    expect(nzd.reduce((sum, row) => sum + row.collectedRevenueCents, 0)).toBe(10_000);
    expect(aud.reduce((sum, row) => sum + row.orderedRevenueCents, 0)).toBe(20_000);
    expect(aud.reduce((sum, row) => sum + row.collectedRevenueCents, 0)).toBe(20_000);
    const trafficTotals = aggregate.filter((row) => row.channel
      === ANALYTICS_DIMENSION_SENTINELS.total);
    expect(trafficTotals).toHaveLength(2);
    expect(trafficTotals).toEqual(expect.arrayContaining([
      expect.objectContaining({ attributionModel: "first_touch", visitors: 1, sessions: 1, pageViews: 2 }),
      expect.objectContaining({ attributionModel: "last_touch", visitors: 1, sessions: 1, pageViews: 2 }),
    ]));
    const channelTraffic = aggregate.filter((row) => row.channel === "google_ads");
    expect(channelTraffic).toHaveLength(2);
    expect(channelTraffic).toEqual(expect.arrayContaining([
      expect.objectContaining({ attributionModel: "first_touch", visitors: 1, sessions: 1, pageViews: 2 }),
      expect.objectContaining({ attributionModel: "last_touch", visitors: 1, sessions: 1, pageViews: 2 }),
    ]));

    await createWebsiteAnalyticsV2Repository(database).markDirtyDate("2297-09-30");
    await reconciliation.rebuildDirtyDate("2297-09-30");
    expect(await reconciliation.readAggregateDailyRows("2297-09-30")).toEqual(raw);
    expect(await database.select().from(websiteAnalyticsDailyAggregates)
      .where(eq(websiteAnalyticsDailyAggregates.localDate, "2297-09-30")))
      .toHaveLength(raw.length);
  });

  it("anchors traffic to pageview date and exposes an exact visitor total across channels", async () => {
    await trafficSession({
      visitorKey: "cross-midnight",
      startedAt: new Date("2297-11-30T23:59:00.000Z"),
      sessionLocalDate: "2297-11-30",
      pageviewLocalDate: "2297-12-01",
      channel: "direct",
      source: "direct",
      medium: null,
    });
    await trafficSession({
      visitorKey: "multi-channel",
      startedAt: new Date("2297-12-01T01:00:00.000Z"),
      sessionLocalDate: "2297-12-01",
      pageviewLocalDate: "2297-12-01",
      channel: "google_ads",
      source: "google",
      medium: "cpc",
    });
    await trafficSession({
      visitorKey: "multi-channel",
      startedAt: new Date("2297-12-01T02:00:00.000Z"),
      sessionLocalDate: "2297-12-01",
      pageviewLocalDate: "2297-12-01",
      channel: "meta_ads",
      source: "facebook",
      medium: "paid_social",
    });

    const rows = await createWebsiteAnalyticsV2Reconciliation(database)
      .readRawDailyRows("2297-12-01");
    for (const attributionModel of ["first_touch", "last_touch"] as const) {
      const [total] = rows.filter((row) => row.attributionModel === attributionModel
        && row.channel === ANALYTICS_DIMENSION_SENTINELS.total);
      expect(total).toMatchObject({
        source: ANALYTICS_DIMENSION_SENTINELS.total,
        medium: ANALYTICS_DIMENSION_SENTINELS.total,
        campaign: ANALYTICS_DIMENSION_SENTINELS.total,
        visitors: 2,
        sessions: 3,
        pageViews: 3,
      });
      const channelRows = rows.filter((row) => row.attributionModel === attributionModel
        && row.channel !== ANALYTICS_DIMENSION_SENTINELS.total);
      expect(channelRows.map((row) => ({
        channel: row.channel,
        visitors: row.visitors,
        sessions: row.sessions,
        pageViews: row.pageViews,
      }))).toEqual([
        { channel: "direct", visitors: 1, sessions: 1, pageViews: 1 },
        { channel: "google_ads", visitors: 1, sessions: 1, pageViews: 1 },
        { channel: "meta_ads", visitors: 1, sessions: 1, pageViews: 1 },
      ]);
      expect(channelRows.reduce((sum, row) => sum + row.visitors, 0)).toBe(3);
    }
  });

  it("normalizes legacy self-referral traffic into Direct aggregates", async () => {
    await trafficSession({
      visitorKey: "legacy-self-referrer",
      startedAt: new Date("2297-12-02T01:00:00.000Z"),
      sessionLocalDate: "2297-12-02",
      pageviewLocalDate: "2297-12-02",
      channel: "other",
      source: "rnrgallery.com",
      medium: "referral",
      utmCampaign: null,
    });

    const reconciliation = createWebsiteAnalyticsV2Reconciliation(database);
    await createWebsiteAnalyticsV2Repository(database).markDirtyDate("2297-12-02");
    expect(await reconciliation.rebuildDirtyDate("2297-12-02"))
      .toEqual({ rebuilt: 1, busy: 0, failed: 0 });
    const rows = await reconciliation.readAggregateDailyRows("2297-12-02");
    const dimensions = rows.filter((row) => row.channel !== ANALYTICS_DIMENSION_SENTINELS.total);

    expect(dimensions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        attributionModel: "first_touch",
        channel: "direct",
        source: "direct",
        medium: ANALYTICS_DIMENSION_SENTINELS.notSet,
        sessions: 1,
        pageViews: 1,
      }),
      expect.objectContaining({
        attributionModel: "last_touch",
        channel: "direct",
        source: "direct",
        medium: ANALYTICS_DIMENSION_SENTINELS.notSet,
        sessions: 1,
        pageViews: 1,
      }),
    ]));
    expect(dimensions.some((row) => row.source === "rnrgallery.com")).toBe(false);
  });

  it("dirties and rebuilds the exact late refund occurrence date", async () => {
    const order = await websiteOrder({
      sourceId: `${prefix}late-refund-order`,
      occurredAt: new Date("2297-09-30T05:00:00.000Z"),
      amountCents: 8_000,
      market: "NZ",
    });
    await financial({
      conversionId: order.factId,
      sourceId: `${prefix}late-refund-receipt`,
      occurredAt: new Date("2297-09-30T06:00:00.000Z"),
      amountCents: 8_000,
      currency: "NZD",
      eventType: "receipt",
    });
    await financial({
      conversionId: order.factId,
      sourceId: `${prefix}late-refund`,
      occurredAt: new Date("2297-10-01T01:00:00.000Z"),
      amountCents: 2_000,
      currency: "NZD",
      eventType: "refund",
    });
    const state = await database.select({
      localDate: websiteAnalyticsReconciliationState.localDate,
      status: websiteAnalyticsReconciliationState.status,
    }).from(websiteAnalyticsReconciliationState).where(and(
      eq(websiteAnalyticsReconciliationState.stateType, "dirty_date"),
      eq(websiteAnalyticsReconciliationState.stateKey, "2297-10-01"),
    ));
    expect(state).toEqual([{ localDate: "2297-10-01", status: "pending" }]);
    const reconciliation = createWebsiteAnalyticsV2Reconciliation(database);
    await reconciliation.rebuildDirtyDate("2297-10-01");
    const raw = await reconciliation.readRawDailyRows("2297-10-01");
    expect(await reconciliation.readAggregateDailyRows("2297-10-01")).toEqual(raw);
    expect(raw.filter((row) => row.currency === "NZD"
      && row.scope === "website" && row.attributionModel === "last_touch")
      .reduce((sum, row) => sum + row.refundedRevenueCents, 0)).toBe(2_000);
  });

  it("repairs recent authoritative facts and rebuilds a bounded recent window", async () => {
    const conversationId = await sourceInquiry(new Date("2297-10-03T00:00:00.000Z"));
    const reconciliation = createWebsiteAnalyticsV2Reconciliation(database);
    const result = await reconciliation.run({
      now: new Date("2297-10-03T01:00:00.000Z"),
      recentDays: 2,
      repairBatchSize: 10,
      maxDirtyDates: 2,
      sources: ["website_inquiries"],
      stateKeyPrefix: `${prefix}recent`,
    });
    expect(result.repair.totals).toMatchObject({ scanned: 1, created: 1, failed: 0 });
    expect(result.aggregates).toMatchObject({ rebuilt: 2, busy: 0, failed: 0 });
    expect(await database.select({ id: websiteAnalyticsConversions.id })
      .from(websiteAnalyticsConversions)
      .where(eq(websiteAnalyticsConversions.sourceId, conversationId))).toHaveLength(1);
    expect(await reconciliation.readAggregateDailyRows("2297-10-03"))
      .toEqual(await reconciliation.readRawDailyRows("2297-10-03"));
  });

  it("resumes an unfinished bounded source after date rollover and starts a new cycle", async () => {
    await sourceInquiry(new Date("2297-11-10T00:00:00.000Z"));
    await sourceInquiry(new Date("2297-11-10T01:00:00.000Z"));
    await sourceInquiry(new Date("2297-11-10T02:00:00.000Z"));
    const reconciliation = createWebsiteAnalyticsV2Reconciliation(database);
    const stateKeyPrefix = `${prefix}rollover`;

    const first = await reconciliation.run({
      now: new Date("2297-11-11T01:00:00.000Z"),
      recentDays: 2,
      repairBatchSize: 2,
      maxDirtyDates: 2,
      sources: ["website_inquiries"],
      stateKeyPrefix,
    });
    expect(first.repair.totals).toMatchObject({ scanned: 2, created: 2, failed: 0 });
    expect(first.repair.sources[0]?.complete).toBe(false);

    const second = await reconciliation.run({
      now: new Date("2297-11-12T01:00:00.000Z"),
      recentDays: 2,
      repairBatchSize: 2,
      maxDirtyDates: 2,
      sources: ["website_inquiries"],
      stateKeyPrefix,
    });
    expect(second.repair.totals).toMatchObject({ scanned: 1, created: 1, failed: 0 });
    expect(second.repair.sources[0]?.complete).toBe(true);

    const lateConversationId = await sourceInquiry(new Date("2297-11-12T02:00:00.000Z"));
    const third = await reconciliation.run({
      now: new Date("2297-11-13T01:00:00.000Z"),
      recentDays: 2,
      repairBatchSize: 10,
      maxDirtyDates: 2,
      sources: ["website_inquiries"],
      stateKeyPrefix,
    });
    expect(third.repair.totals).toMatchObject({ scanned: 1, created: 1, failed: 0 });
    expect(await database.select({ id: websiteAnalyticsConversions.id })
      .from(websiteAnalyticsConversions)
      .where(eq(websiteAnalyticsConversions.sourceId, lateConversationId))).toHaveLength(1);

    expect(await database.select({
      stateKey: websiteAnalyticsReconciliationState.stateKey,
      status: websiteAnalyticsReconciliationState.status,
    }).from(websiteAnalyticsReconciliationState).where(and(
      eq(websiteAnalyticsReconciliationState.stateType, "reconciliation"),
      sql`${websiteAnalyticsReconciliationState.stateKey} like ${`${stateKeyPrefix}%`}`,
    ))).toEqual([{
      stateKey: `${stateKeyPrefix}:website_inquiries`,
      status: "completed",
    }]);
  });

  it("does not lose a concurrent dirty mark while completing a rebuild", async () => {
    const reconciliation = createWebsiteAnalyticsV2Reconciliation(database);
    const repository = createWebsiteAnalyticsV2Repository(database);
    await repository.markDirtyDate("2297-10-02");
    const suffix = runId.replaceAll("-", "");
    const functionName = `task5_dirty_pause_${suffix}`;
    const triggerName = `task5_dirty_pause_trigger_${suffix}`;
    await database.execute(sql.raw(`
      create function ${functionName}() returns trigger language plpgsql as $$
      begin
        perform pg_sleep(0.2);
        return new;
      end
      $$;
      create trigger ${triggerName}
        before update on website_analytics_reconciliation_state
        for each row
        when (new.status = 'completed' and new.state_key = '2297-10-02')
        execute function ${functionName}();
    `));
    try {
      const rebuilding = reconciliation.rebuildDirtyDate("2297-10-02");
      await new Promise((resolve) => setTimeout(resolve, 50));
      const marking = repository.markDirtyDate("2297-10-02");
      await Promise.all([rebuilding, marking]);
    } finally {
      await database.execute(sql.raw(`drop trigger if exists ${triggerName}
        on website_analytics_reconciliation_state`));
      await database.execute(sql.raw(`drop function if exists ${functionName}()`));
    }
    expect(await database.select({
      status: websiteAnalyticsReconciliationState.status,
      startedAt: websiteAnalyticsReconciliationState.startedAt,
      completedAt: websiteAnalyticsReconciliationState.completedAt,
    }).from(websiteAnalyticsReconciliationState).where(and(
      eq(websiteAnalyticsReconciliationState.stateType, "dirty_date"),
      eq(websiteAnalyticsReconciliationState.stateKey, "2297-10-02"),
    ))).toEqual([{ status: "pending", startedAt: null, completedAt: null }]);
  });
});
