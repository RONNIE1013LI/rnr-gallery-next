import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
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
import { createWebsiteAnalyticsV2Reconciliation } from "./website-analytics-v2-reconciliation";
import { createWebsiteAnalyticsV2Repository } from "./website-analytics-v2-repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");
const identity = new URL(testDatabaseUrl);
if (!new Set(["127.0.0.1", "localhost"]).has(identity.hostname)
  || identity.pathname !== "/rnr_website_analytics_test") {
  throw new Error("The local rnr website analytics Test database is required");
}

const pool = new Pool({ connectionString: testDatabaseUrl, max: 6 });
const database = drizzle(pool);
const runId = randomUUID();
const prefix = `analytics-v2-task5-reconcile:${runId}:`;
const localDates = ["2297-09-30", "2297-10-01", "2297-10-02", "2297-10-03"];
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
    const nzd = aggregate.filter((row) => row.currency === "NZD"
      && row.scope === "website" && row.attributionModel === "last_touch");
    const aud = aggregate.filter((row) => row.currency === "AUD"
      && row.scope === "website" && row.attributionModel === "last_touch");
    expect(nzd.reduce((sum, row) => sum + row.orderedRevenueCents, 0)).toBe(10_000);
    expect(nzd.reduce((sum, row) => sum + row.collectedRevenueCents, 0)).toBe(10_000);
    expect(aud.reduce((sum, row) => sum + row.orderedRevenueCents, 0)).toBe(20_000);
    expect(aud.reduce((sum, row) => sum + row.collectedRevenueCents, 0)).toBe(20_000);
    expect(aggregate.reduce((sum, row) => sum + row.sessions, 0)).toBe(2);
    expect(aggregate.reduce((sum, row) => sum + row.pageViews, 0)).toBe(4);

    await createWebsiteAnalyticsV2Repository(database).markDirtyDate("2297-09-30");
    await reconciliation.rebuildDirtyDate("2297-09-30");
    expect(await reconciliation.readAggregateDailyRows("2297-09-30")).toEqual(raw);
    expect(await database.select().from(websiteAnalyticsDailyAggregates)
      .where(eq(websiteAnalyticsDailyAggregates.localDate, "2297-09-30")))
      .toHaveLength(raw.length);
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
