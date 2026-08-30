import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ANALYTICS_DIMENSION_SENTINELS } from "@/domain/analytics/website-analytics-v2";
import {
  checkoutSessions,
  orders,
  productionJobs,
  websiteAnalyticsConversions,
  websiteAnalyticsDailyAggregates,
  websiteAnalyticsFinancialEvents,
  websiteAnalyticsReconciliationState,
  websiteAnalyticsSessions,
} from "@/server/db/schema";
import { isDedicatedTestDatabase } from "@/server/db/test-database-safety";
import { createWebsiteAnalyticsV2Repository } from "./website-analytics-v2-repository";
import { createWebsiteAnalyticsV2Dashboard } from "./website-analytics-v2-dashboard";
import { parseWebsiteAnalyticsV2Query } from "./website-analytics-v2-query";
import { analyticsPaymentStatusSql } from "./website-analytics-business-rules";
import { createWebsiteAnalyticsV2Reconciliation } from "./website-analytics-v2-reconciliation";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");
if (!isDedicatedTestDatabase(testDatabaseUrl, process.env.DATABASE_URL)) {
  throw new Error("A dedicated website analytics Test database is required");
}

const pool = new Pool({ connectionString: testDatabaseUrl, max: 4 });
const database = drizzle(pool);
const dashboard = createWebsiteAnalyticsV2Dashboard(database);
const runId = randomUUID();
const prefix = `analytics-v2-task6:${runId}:`;
const priorDate = "2398-01-14";
const currentDate = "2398-01-15";
const preTrackingDate = "2397-12-01";
const emptyDate = "2398-02-01";
const internalDate = "2398-02-03";
const dates = [priorDate, currentDate, emptyDate, internalDate];
const now = new Date("2398-01-15T01:00:00.000Z");
const sessionIds: string[] = [];
const checkoutSessionIds: string[] = [];
const orderIds: string[] = [];
const jobIds: string[] = [];

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

function query(value: string) {
  return parseWebsiteAnalyticsV2Query(new URLSearchParams(value), { now });
}

async function createOrderParent(amountCents: number) {
  const [checkout] = await database.insert(checkoutSessions).values({
    tokenDigest: digest(`${prefix}checkout:${randomUUID()}`),
    expiresAt: new Date("2399-01-01T00:00:00.000Z"),
    completedAt: new Date("2398-01-14T12:00:00.000Z"),
  }).returning({ id: checkoutSessions.id });
  checkoutSessionIds.push(checkout!.id);
  const [order] = await database.insert(orders).values({
    orderNumber: `A6-${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    checkoutSessionId: checkout!.id,
    checkoutSessionVersion: 1,
    idempotencyKey: randomUUID(),
    customerEmail: "private-task6@example.test",
    market: "NZ",
    currency: "NZD",
    taxJurisdiction: "NZ_GST",
    taxRateBasisPoints: 0,
    pricingSnapshot: {
      schemaVersion: 1,
      market: "NZ",
      currency: "NZD",
      priceBookRevision: 0,
      taxJurisdiction: "NZ_GST",
      taxRateBasisPoints: 0,
      items: [],
      productSubtotalExTaxCents: amountCents,
      productTaxCents: 0,
      productTotalInclTaxCents: amountCents,
      designSurchargeCents: 0,
      discountCents: 0,
      shipping: {
        method: "pickup",
        serviceCode: "pickup",
        currency: "NZD",
        amountExTaxCents: 0,
        taxCents: 0,
        amountInclTaxCents: 0,
      },
      taxAmountCents: 0,
      finalTotalCents: amountCents,
    },
    deliveryMethod: "pickup",
    shippingServiceCode: "pickup",
    shippingServiceName: "Pickup",
    productSubtotalExGstCents: amountCents,
    productGstCents: 0,
    productTotalInclGstCents: amountCents,
    shippingExGstCents: 0,
    shippingGstCents: 0,
    shippingTotalInclGstCents: 0,
    totalExGstCents: amountCents,
    totalGstCents: 0,
    totalInclGstCents: amountCents,
    createdAt: new Date("2398-01-14T12:00:00.000Z"),
  }).returning({ id: orders.id, orderNumber: orders.orderNumber });
  orderIds.push(order!.id);
  return order!;
}

async function createJobParent(amountCents: number) {
  const id = randomUUID();
  jobIds.push(id);
  const jobNumber = `A6M-${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  await database.insert(productionJobs).values({
    id,
    jobNumber,
    source: "manual",
    idempotencyKey: randomUUID(),
    requestDigest: digest(`${prefix}job:${id}`),
    customerName: "Private Task 6 Customer",
    customerEmail: "private-manual-task6@example.test",
    customerPhone: "0210000000",
    customerSource: "walk_in",
    manualStatus: "new",
    manualPaymentStatus: "awaiting_payment",
    neededDate: "2398-01-20",
    deliveryMethod: "pickup",
    amountPayableCents: amountCents,
    amountPaidCents: 0,
    artistFeeCents: 0,
    materialCostCents: 0,
    createdAt: new Date("2398-01-14T13:00:00.000Z"),
  });
  return { id, jobNumber };
}

async function seedPriorAggregates() {
  const common = {
    localDate: priorDate,
    attributionModel: "last_touch" as const,
    rulesVersion: "v2",
  };
  await database.insert(websiteAnalyticsDailyAggregates).values([
    {
      ...common,
      scope: "website",
      market: "Unattributed",
      currency: "(not set)",
      channel: ANALYTICS_DIMENSION_SENTINELS.total,
      source: ANALYTICS_DIMENSION_SENTINELS.total,
      medium: ANALYTICS_DIMENSION_SENTINELS.total,
      campaign: ANALYTICS_DIMENSION_SENTINELS.total,
      visitors: 2,
      sessions: 3,
      pageViews: 5,
    },
    {
      ...common,
      scope: "website",
      market: "Unattributed",
      currency: "(not set)",
      channel: "google_ads",
      source: "google",
      medium: "cpc",
      campaign: `${prefix}prior-campaign`,
      visitors: 2,
      sessions: 3,
      pageViews: 5,
    },
    {
      ...common,
      scope: "website",
      market: "NZ",
      currency: "NZD",
      channel: "google_ads",
      source: "google",
      medium: "cpc",
      campaign: `${prefix}prior-campaign`,
      inquiries: 1,
      orders: 1,
      paidOrders: 1,
      orderedRevenueCents: 10_000,
      collectedRevenueCents: 10_000,
      refundedRevenueCents: 1_000,
      netCollectedRevenueCents: 9_000,
    },
    {
      ...common,
      scope: "all_business",
      market: "NZ",
      currency: "NZD",
      channel: "google_ads",
      source: "google",
      medium: "cpc",
      campaign: `${prefix}prior-campaign`,
      orders: 1,
      paidOrders: 1,
      orderedRevenueCents: 10_000,
      collectedRevenueCents: 10_000,
      refundedRevenueCents: 1_000,
      netCollectedRevenueCents: 9_000,
    },
    {
      ...common,
      scope: "all_business",
      market: "AU",
      currency: "AUD",
      channel: "manual",
      source: ANALYTICS_DIMENSION_SENTINELS.manualOffline,
      medium: ANALYTICS_DIMENSION_SENTINELS.notSet,
      campaign: ANALYTICS_DIMENSION_SENTINELS.notSet,
      orders: 1,
      orderedRevenueCents: 20_000,
      collectedRevenueCents: 5_000,
      netCollectedRevenueCents: 5_000,
    },
    {
      ...common,
      localDate: currentDate,
      scope: "website",
      market: "Unattributed",
      currency: "(not set)",
      channel: ANALYTICS_DIMENSION_SENTINELS.total,
      source: ANALYTICS_DIMENSION_SENTINELS.total,
      medium: ANALYTICS_DIMENSION_SENTINELS.total,
      campaign: ANALYTICS_DIMENSION_SENTINELS.total,
      visitors: 999,
      sessions: 999,
      pageViews: 999,
    },
  ]);
}

async function seedRetainedPriorTraffic() {
  const returningVisitor = digest(`${prefix}returning-visitor`);
  const priorVisitors = [returningVisitor, returningVisitor, digest(`${prefix}prior-visitor`)];
  for (const [index, visitorDigest] of priorVisitors.entries()) {
    const sessionId = randomUUID();
    sessionIds.push(sessionId);
    await database.insert(websiteAnalyticsSessions).values({
      id: sessionId,
      visitorDigest,
      startedAt: new Date(`2398-01-13T1${index + 1}:00:00.000Z`),
      localDate: priorDate,
      channel: "google_ads",
      source: "google",
      medium: "cpc",
      utmCampaign: `${prefix}prior-campaign`,
      countryCode: "NZ",
    });
    const priorPageCount = index === 2 ? 3 : 1;
    for (let page = 0; page < priorPageCount; page += 1) {
      await database.execute(sql`
        insert into website_analytics_pageviews
          (id, session_id, occurred_at, local_date, pathname)
        values
          (${randomUUID()}::uuid, ${sessionId}::uuid,
            ${new Date(`2398-01-13T1${index + 1}:${page}5:00.000Z`)}, ${priorDate}::date,
            ${`/retained/${index}/${page}`})
      `);
    }
    if (index === 0) {
      await database.execute(sql`
        insert into website_analytics_pageviews
          (id, session_id, occurred_at, local_date, pathname)
        values
          (${randomUUID()}::uuid, ${sessionId}::uuid,
            ${new Date("2398-01-14T12:01:00.000Z")}, ${currentDate}::date,
            '/retained/cross-midnight')
      `);
    }
  }
}

async function seedCurrentRawFacts() {
  const visitorDigest = digest(`${prefix}current-visitor`);
  for (const [index, channel] of (["direct", "meta_ads"] as const).entries()) {
    const sessionId = randomUUID();
    sessionIds.push(sessionId);
    await database.insert(websiteAnalyticsSessions).values({
      id: sessionId,
      visitorDigest,
      startedAt: new Date(`2398-01-14T1${index + 2}:00:00.000Z`),
      localDate: currentDate,
      channel,
      source: channel === "direct" ? "direct" : "meta",
      medium: channel === "direct" ? null : "paid_social",
      utmCampaign: channel === "direct" ? null : `${prefix}current-campaign`,
      countryCode: index === 0 ? "NZ" : "AU",
    });
    await database.execute(sql`
      insert into website_analytics_pageviews
        (id, session_id, occurred_at, local_date, pathname)
      values
        (${randomUUID()}::uuid, ${sessionId}::uuid,
          ${new Date(`2398-01-14T1${index + 2}:05:00.000Z`)}, ${currentDate}::date,
          ${index === 0 ? "/shop" : "/products/task-6"})
    `);
  }

  const repository = createWebsiteAnalyticsV2Repository(database);
  await repository.recordInquiry({
    sourceId: `${prefix}inquiry`,
    occurredAt: new Date("2398-01-14T12:30:00.000Z"),
    historical: true,
    consentLinked: false,
  });
  const orderParent = await createOrderParent(12_000);
  const website = await repository.recordOrder({
    source: "website",
    sourceId: orderParent.id,
    orderId: orderParent.id,
    occurredAt: new Date("2398-01-14T12:00:00.000Z"),
    market: "NZ",
    currency: "NZD",
    orderedAmountInclGstCents: 12_000,
    consentLinked: false,
  });
  await repository.recordFinancialEvent({
    conversionId: website.factId,
    orderId: orderParent.id,
    eventType: "receipt",
    sourceType: "payment_provider_event",
    sourceId: `${prefix}website-receipt`,
    amountCents: 12_000,
    currency: "NZD",
    occurredAt: new Date("2398-01-14T14:00:00.000Z"),
  });
  await repository.recordFinancialEvent({
    conversionId: website.factId,
    orderId: orderParent.id,
    eventType: "refund",
    sourceType: "payment_provider_event",
    sourceId: `${prefix}website-refund`,
    amountCents: 2_000,
    currency: "NZD",
    occurredAt: new Date("2398-01-14T15:00:00.000Z"),
  });

  const jobParent = await createJobParent(30_000);
  const manual = await repository.recordOrder({
    source: "manual",
    sourceId: jobParent.id,
    productionJobId: jobParent.id,
    occurredAt: new Date("2398-01-14T13:00:00.000Z"),
    market: "AU",
    currency: "AUD",
    orderedAmountInclGstCents: 30_000,
  });
  await repository.recordFinancialEvent({
    conversionId: manual.factId,
    productionJobId: jobParent.id,
    eventType: "receipt",
    sourceType: "manual_payment_update",
    sourceId: `${prefix}manual-receipt`,
    amountCents: 10_000,
    currency: "AUD",
    occurredAt: new Date("2398-01-14T16:00:00.000Z"),
  });
  return { orderParent, jobParent };
}

let references: Awaited<ReturnType<typeof seedCurrentRawFacts>>;

beforeAll(async () => {
  await database.delete(websiteAnalyticsDailyAggregates)
    .where(inArray(websiteAnalyticsDailyAggregates.localDate, dates));
  await database.delete(websiteAnalyticsReconciliationState).where(and(
    eq(websiteAnalyticsReconciliationState.stateType, "dirty_date"),
    inArray(websiteAnalyticsReconciliationState.stateKey, dates),
  ));
  await seedPriorAggregates();
  await seedRetainedPriorTraffic();
  references = await seedCurrentRawFacts();
});

afterAll(async () => {
  await database.delete(websiteAnalyticsDailyAggregates)
    .where(inArray(websiteAnalyticsDailyAggregates.localDate, dates));
  await database.delete(websiteAnalyticsFinancialEvents)
    .where(sql`${websiteAnalyticsFinancialEvents.sourceId} like ${`${prefix}%`}`);
  await database.delete(websiteAnalyticsConversions).where(sql`
    ${websiteAnalyticsConversions.sourceId} like ${`${prefix}%`}
    or ${websiteAnalyticsConversions.orderId} in (${sql.join(orderIds.map((id) => sql`${id}::uuid`), sql`, `)})
    or ${websiteAnalyticsConversions.productionJobId} in (${sql.join(jobIds.map((id) => sql`${id}::uuid`), sql`, `)})
  `);
  await database.delete(websiteAnalyticsReconciliationState).where(and(
    eq(websiteAnalyticsReconciliationState.stateType, "dirty_date"),
    inArray(websiteAnalyticsReconciliationState.stateKey, dates),
  ));
  if (sessionIds.length > 0) {
    await database.delete(websiteAnalyticsSessions).where(inArray(websiteAnalyticsSessions.id, sessionIds));
  }
  if (jobIds.length > 0) await database.delete(productionJobs).where(inArray(productionJobs.id, jobIds));
  if (orderIds.length > 0) await database.delete(orders).where(inArray(orders.id, orderIds));
  if (checkoutSessionIds.length > 0) {
    await database.delete(checkoutSessions).where(inArray(checkoutSessions.id, checkoutSessionIds));
  }
  await pool.end();
});

function money(result: Awaited<ReturnType<typeof dashboard.load>>, currency: "NZD" | "AUD") {
  return result.kpis.money.find((row) => row.currency === currency);
}

describe("website analytics V2 dashboard", () => {
  it("excludes internal traffic and conversions by default and restores them for Admin queries", async () => {
    const repository = createWebsiteAnalyticsV2Repository(database);
    const reconciliation = createWebsiteAnalyticsV2Reconciliation(database);
    const externalVisitor = digest(`${prefix}internal-filter:external`);
    const internalVisitor = digest(`${prefix}internal-filter:internal`);
    const externalSessionId = randomUUID();
    const internalSessionId = randomUUID();
    sessionIds.push(externalSessionId, internalSessionId);
    await database.insert(websiteAnalyticsSessions).values([
      {
        id: externalSessionId,
        visitorDigest: externalVisitor,
        startedAt: new Date("2398-02-03T01:00:00.000Z"),
        localDate: internalDate,
        channel: "google_ads",
        source: "google",
        medium: "cpc",
        utmCampaign: `${prefix}external-campaign`,
        isInternal: false,
      },
      {
        id: internalSessionId,
        visitorDigest: internalVisitor,
        startedAt: new Date("2398-02-03T02:00:00.000Z"),
        localDate: internalDate,
        channel: "meta_ads",
        source: "facebook",
        medium: "paid_social",
        utmCampaign: `${prefix}internal-campaign`,
        isInternal: true,
      },
    ]);
    await database.execute(sql`
      insert into website_analytics_pageviews
        (id, session_id, occurred_at, local_date, pathname)
      values
        (${randomUUID()}::uuid, ${externalSessionId}::uuid,
          ${new Date("2398-02-03T01:01:00.000Z")}, ${internalDate}::date, '/external'),
        (${randomUUID()}::uuid, ${internalSessionId}::uuid,
          ${new Date("2398-02-03T02:01:00.000Z")}, ${internalDate}::date, '/internal')
    `);
    const externalOrderParent = await createOrderParent(10_000);
    await repository.recordOrder({
      source: "website",
      sourceId: externalOrderParent.id,
      orderId: externalOrderParent.id,
      occurredAt: new Date("2398-02-03T04:00:00.000Z"),
      market: "NZ",
      currency: "NZD",
      orderedAmountInclGstCents: 10_000,
      consentLinked: true,
      visitorDigest: externalVisitor,
      convertingSessionId: externalSessionId,
    });
    const internalOrderParent = await createOrderParent(20_000);
    await repository.recordOrder({
      source: "website",
      sourceId: internalOrderParent.id,
      orderId: internalOrderParent.id,
      occurredAt: new Date("2398-02-03T04:01:00.000Z"),
      market: "NZ",
      currency: "NZD",
      orderedAmountInclGstCents: 20_000,
      consentLinked: true,
      visitorDigest: internalVisitor,
      convertingSessionId: internalSessionId,
    });
    await reconciliation.rebuildDirtyDate(internalDate);

    const internalNow = new Date("2398-02-04T01:00:00.000Z");
    const base = `preset=custom&from=${internalDate}&to=${internalDate}&scope=website`;
    const externalOnlyQuery = parseWebsiteAnalyticsV2Query(new URLSearchParams(base), {
      now: internalNow,
    });
    const includeInternalQuery = parseWebsiteAnalyticsV2Query(
      new URLSearchParams(`${base}&includeInternal=true`),
      { now: internalNow },
    );
    const [externalOnly, withInternal, externalOrders, allOrders] = await Promise.all([
      dashboard.load(externalOnlyQuery, internalNow),
      dashboard.load(includeInternalQuery, internalNow),
      dashboard.listOrders(externalOnlyQuery),
      dashboard.listOrders(includeInternalQuery),
    ]);

    expect(externalOnly.kpis).toMatchObject({
      visitors: 1, sessions: 1, pageViews: 1, inquiries: 0, orders: 1,
    });
    expect(money(externalOnly, "NZD")?.orderedRevenueCents).toBe(10_000);
    expect(externalOnly.channels).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: "google_ads", sessions: 1, pageViews: 1 }),
    ]));
    expect(externalOnly.channels).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: "meta_ads" }),
    ]));
    expect(externalOnly.payments).toEqual([{ status: "unpaid", orders: 1 }]);
    expect(externalOrders.total).toBe(1);

    expect(withInternal.kpis).toMatchObject({
      visitors: 2, sessions: 2, pageViews: 2, inquiries: 0, orders: 2,
    });
    expect(money(withInternal, "NZD")?.orderedRevenueCents).toBe(30_000);
    expect(withInternal.channels).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: "google_ads", sessions: 1, pageViews: 1 }),
      expect.objectContaining({ channel: "meta_ads", sessions: 1, pageViews: 1 }),
    ]));
    expect(withInternal.payments).toEqual([{ status: "unpaid", orders: 2 }]);
    expect(allOrders.total).toBe(2);
  });

  it("normalizes every legacy first-party referral in Exact Traffic without folding external referrals", async () => {
    const localDate = "2398-02-02";
    const ownedHosts = [
      "rnrgallery.com",
      "www.rnrgallery.com",
      "rrgallery.co.nz",
      "www.rrgallery.co.nz",
    ];
    const insertedSessions: string[] = [];
    try {
      for (const [index, source] of [...ownedHosts, "partner.example", "facebook.com"].entries()) {
        const id = randomUUID();
        insertedSessions.push(id);
        await database.insert(websiteAnalyticsSessions).values({
          id,
          visitorDigest: digest(`${prefix}self-ref:${source}`),
          startedAt: new Date(`2398-02-01T0${index}:00:00.000Z`),
          localDate,
          channel: "other",
          source,
          medium: "referral",
          utmCampaign: null,
          clickIdType: null,
          countryCode: "NZ",
        });
        await database.execute(sql`
          insert into website_analytics_pageviews
            (id, session_id, occurred_at, local_date, pathname)
          values (${randomUUID()}::uuid, ${id}::uuid,
            ${new Date(`2398-02-01T0${index}:01:00.000Z`)}, ${localDate}::date, '/')
        `);
      }

      const result = await dashboard.load(query(
        `preset=custom&from=${localDate}&to=${localDate}&scope=website`,
      ), new Date("2398-02-02T01:00:00.000Z"));
      expect(result.channels).toEqual(expect.arrayContaining([
        expect.objectContaining({ channel: "direct", visitors: 4, sessions: 4, pageViews: 4 }),
        expect.objectContaining({ channel: "other", visitors: 2, sessions: 2, pageViews: 2 }),
      ]));
      expect(result.campaigns).toEqual(expect.arrayContaining([
        expect.objectContaining({
          channel: "direct", source: "direct", medium: "(not set)",
          campaign: "(not set)", visitors: 4, sessions: 4, pageViews: 4,
        }),
        expect.objectContaining({
          channel: "other", source: "partner.example", medium: "referral",
          visitors: 1, sessions: 1, pageViews: 1,
        }),
        expect.objectContaining({
          channel: "other", source: "facebook.com", medium: "referral",
          visitors: 1, sessions: 1, pageViews: 1,
        }),
      ]));
      expect(result.campaigns).not.toEqual(expect.arrayContaining(ownedHosts.map((source) =>
        expect.objectContaining({ source }))));
      const rawOwned = await database.select({
        source: websiteAnalyticsSessions.source,
        medium: websiteAnalyticsSessions.medium,
        channel: websiteAnalyticsSessions.channel,
      }).from(websiteAnalyticsSessions).where(inArray(
        websiteAnalyticsSessions.source,
        ownedHosts,
      )).orderBy(asc(websiteAnalyticsSessions.source));
      expect(rawOwned).toEqual([...ownedHosts].sort().map((source) => ({
        source,
        medium: "referral",
        channel: "other",
      })));
    } finally {
      if (insertedSessions.length > 0) {
        await database.delete(websiteAnalyticsSessions)
          .where(inArray(websiteAnalyticsSessions.id, insertedSessions));
      }
    }
  });

  it("uses the versioned SQL payment-status adapter for every edge sequence", async () => {
    const expression = analyticsPaymentStatusSql({
      orderedAmountCents: sql`cases.ordered`,
      collectedCents: sql`cases.collected`,
      refundedCents: sql`cases.refunded`,
    });
    const result = await database.execute<{ status: string | null }>(sql`
      select ${expression} as status
      from (values
        (1, 10000, 0, 0),
        (2, 10000, 5000, 0),
        (3, 10000, 10000, 0),
        (4, 10000, 12000, 0),
        (5, 10000, 10000, 1000),
        (6, 10000, 10000, 10000),
        (7, 10000, 20000, 10000)
      ) cases(ordinal, ordered, collected, refunded)
      order by cases.ordinal
    `);
    expect(result.rows.map((row) => row.status)).toEqual([
      "unpaid", "partial", "paid", "paid", "refunded", "refunded", "refunded",
    ]);
  });

  it("keeps Paid Orders inside the order-creation cohort at the report cutoff", async () => {
    const repository = createWebsiteAnalyticsV2Repository(database);
    const reconciliation = createWebsiteAnalyticsV2Reconciliation(database);
    const cohortPrefix = `${prefix}paid-cohort:`;
    const cohortDates = ["2398-03-01", "2398-03-02", "2398-03-03", "2398-03-04"];
    const cohortNow = new Date("2398-03-05T00:00:00.000Z");
    const cohortQuery = (from: string, to: string) => parseWebsiteAnalyticsV2Query(
      new URLSearchParams(`preset=custom&from=${from}&to=${to}&scope=website`),
      { now: cohortNow },
    );

    const order = await repository.recordOrder({
      source: "website",
      sourceId: `${cohortPrefix}order`,
      occurredAt: new Date("2398-02-28T11:00:00.000Z"),
      market: "NZ",
      currency: "NZD",
      orderedAmountInclGstCents: 10_000,
      historical: true,
      consentLinked: false,
    });
    await repository.recordFinancialEvent({
      conversionId: order.factId,
      sourceType: "payment_provider_event",
      sourceId: `${cohortPrefix}receipt-1`,
      eventType: "receipt",
      amountCents: 4_000,
      currency: "NZD",
      occurredAt: new Date("2398-03-01T11:00:00.000Z"),
      historical: true,
    });
    await repository.recordFinancialEvent({
      conversionId: order.factId,
      sourceType: "payment_provider_event",
      sourceId: `${cohortPrefix}receipt-2`,
      eventType: "receipt",
      amountCents: 6_000,
      currency: "NZD",
      occurredAt: new Date("2398-03-02T11:00:00.000Z"),
      historical: true,
    });

    try {
      for (const localDate of cohortDates.slice(0, 3)) {
        await reconciliation.rebuildDirtyDate(localDate);
      }

      const beforeFullPayment = await dashboard.load(
        cohortQuery("2398-03-01", "2398-03-02"),
        cohortNow,
      );
      expect(beforeFullPayment.kpis).toMatchObject({ orders: 1, paidOrders: 0 });

      const throughFullPayment = await dashboard.load(
        cohortQuery("2398-03-01", "2398-03-03"),
        cohortNow,
      );
      expect(throughFullPayment.kpis).toMatchObject({ orders: 1, paidOrders: 1 });
      expect(throughFullPayment.timeseries).toEqual(expect.arrayContaining([
        expect.objectContaining({ bucket: "2398-03-01", orders: 1, paidOrders: 1 }),
        expect.objectContaining({ bucket: "2398-03-03", orders: 0, paidOrders: 0 }),
      ]));

      const paymentDateOnly = await dashboard.load(
        cohortQuery("2398-03-03", "2398-03-03"),
        cohortNow,
      );
      expect(paymentDateOnly.kpis).toMatchObject({ orders: 0, paidOrders: 0 });

      await repository.recordFinancialEvent({
        conversionId: order.factId,
        sourceType: "payment_provider_event",
        sourceId: `${cohortPrefix}late-refund`,
        eventType: "refund",
        amountCents: 1,
        currency: "NZD",
        occurredAt: new Date("2398-03-03T11:00:00.000Z"),
        historical: true,
      });
      const afterLateRefund = await dashboard.load(
        cohortQuery("2398-03-01", "2398-03-04"),
        cohortNow,
      );
      expect(afterLateRefund.kpis).toMatchObject({ orders: 1, paidOrders: 0 });
      expect(afterLateRefund.kpis.paidOrders).toBeLessThanOrEqual(afterLateRefund.kpis.orders);
    } finally {
      await database.delete(websiteAnalyticsDailyAggregates)
        .where(inArray(websiteAnalyticsDailyAggregates.localDate, cohortDates));
      await database.delete(websiteAnalyticsReconciliationState).where(and(
        eq(websiteAnalyticsReconciliationState.stateType, "dirty_date"),
        inArray(websiteAnalyticsReconciliationState.stateKey, cohortDates),
      ));
      await database.delete(websiteAnalyticsFinancialEvents)
        .where(sql`${websiteAnalyticsFinancialEvents.sourceId} like ${`${cohortPrefix}%`}`);
      await database.delete(websiteAnalyticsConversions)
        .where(eq(websiteAnalyticsConversions.sourceId, `${cohortPrefix}order`));
    }
  });

  it("combines prior aggregates with current raw facts exactly once for Website scope", async () => {
    const result = await dashboard.load(query(
      `preset=custom&from=${priorDate}&to=${currentDate}&scope=website`,
    ), now);
    expect(result.kpis).toMatchObject({
      visitors: 3,
      sessions: 5,
      pageViews: 8,
      inquiries: 2,
      orders: 2,
      paidOrders: 0,
      inquiryConversionRate: 0.4,
      orderConversionRate: 0.4,
      paidOrderConversionRate: 0,
    });
    expect(money(result, "NZD")).toEqual({
      currency: "NZD",
      orderedRevenueCents: 22_000,
      collectedRevenueCents: 22_000,
      refundedRevenueCents: 3_000,
      netCollectedRevenueCents: 19_000,
      orderedAovCents: 11_000,
    });
    expect(money(result, "AUD")).toBeUndefined();
    expect(result.timeseries).toHaveLength(2);
    expect(result.funnel).toMatchObject({
      scope: "website",
      sessions: 5,
      inquiries: 2,
      orders: 2,
      paidOrders: 0,
    });
    expect(result.metadata).toMatchObject({
      timezone: "Pacific/Auckland",
      trafficScope: "website",
      aggregateThrough: priorDate,
      rawDates: [currentDate],
    });
  });

  it("adds manual orders only in All Business while retaining a Website-only funnel", async () => {
    const result = await dashboard.load(query(
      `preset=custom&from=${priorDate}&to=${currentDate}&scope=all_business`,
    ), now);
    expect(result.kpis).toMatchObject({
      visitors: 3,
      sessions: 5,
      pageViews: 8,
      inquiries: 2,
      orders: 4,
      paidOrders: 0,
      inquiryConversionRate: 0.4,
      orderConversionRate: 0.4,
      paidOrderConversionRate: 0,
    });
    expect(money(result, "NZD")).toMatchObject({ orderedRevenueCents: 22_000 });
    expect(money(result, "AUD")).toEqual({
      currency: "AUD",
      orderedRevenueCents: 50_000,
      collectedRevenueCents: 15_000,
      refundedRevenueCents: 0,
      netCollectedRevenueCents: 15_000,
      orderedAovCents: 25_000,
    });
    expect(result.funnel).toMatchObject({
      scope: "website",
      sessions: 5,
      inquiries: 2,
      orders: 2,
      paidOrders: 0,
    });
    expect(result.channels.some((row) => row.channel
      === ANALYTICS_DIMENSION_SENTINELS.manualOffline)).toBe(true);
    expect(result.timeseries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        bucket: priorDate,
        orders: 2,
        orderConversionRate: 1 / 3,
      }),
      expect.objectContaining({
        bucket: currentDate,
        orders: 2,
        orderConversionRate: 1 / 3,
      }),
    ]));
  });

  it("keeps zero-denominator rates null and marks unprovable page metrics unavailable", async () => {
    const result = await dashboard.load(query(
      `preset=custom&from=${emptyDate}&to=${emptyDate}`,
    ), new Date("2398-02-01T01:00:00.000Z"));
    expect(result.kpis).toMatchObject({
      visitors: 0,
      sessions: 0,
      inquiries: 0,
      orders: 0,
      inquiryConversionRate: null,
      orderConversionRate: null,
      paidOrderConversionRate: null,
      money: [],
    });
    expect(result.pages).toEqual({
      items: [],
      available: true,
      coverageFrom: priorDate,
      unavailableMetrics: ["entrances", "exits", "assists"],
    });
  });

  it("deduplicates retained visitors and cross-midnight sessions for the range and week/month buckets", async () => {
    for (const granularity of ["week", "month"] as const) {
      const result = await dashboard.load(query(
        `preset=custom&from=${priorDate}&to=${currentDate}&scope=website&granularity=${granularity}`,
      ), now);
      expect(result.kpis).toMatchObject({ visitors: 3, sessions: 5, pageViews: 8 });
      expect(result.timeseries).toEqual([
        expect.objectContaining({ visitors: 3, sessions: 5, pageViews: 8 }),
      ]);
      expect(result.metadata).toMatchObject({ trafficMetricsAvailable: true });
    }
  });

  it("deduplicates retained visitors and cross-midnight sessions within channel and campaign groups", async () => {
    const result = await dashboard.load(query(
      `preset=custom&from=${priorDate}&to=${currentDate}&scope=website`,
    ), now);
    expect(result.channels).toEqual(expect.arrayContaining([
      expect.objectContaining({
        channel: "google_ads",
        visitors: 2,
        sessions: 3,
        pageViews: 6,
      }),
    ]));
    expect(result.campaigns).toEqual(expect.arrayContaining([
      expect.objectContaining({
        channel: "google_ads",
        source: "google",
        medium: "cpc",
        campaign: `${prefix}prior-campaign`,
        visitors: 2,
        sessions: 3,
        pageViews: 6,
      }),
    ]));
  });

  it("marks a retained-range request before actual V1 tracking began as unavailable", async () => {
    const result = await dashboard.load(query(
      `preset=custom&from=${preTrackingDate}&to=${preTrackingDate}&scope=website`,
    ), now);
    expect(result.kpis).toMatchObject({ visitors: null, sessions: null });
    expect(result.metadata).toMatchObject({
      earliestTrafficDate: priorDate,
      trafficCoverageFrom: priorDate,
      trafficMetricsAvailable: false,
    });
    expect(result.notices).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "traffic_retention_limited" }),
      expect.objectContaining({ code: "traffic_breakdowns_unavailable" }),
    ]));
    expect(result.pages).toMatchObject({ items: [], available: false, coverageFrom: priorDate });
    expect(result.countries).toEqual([]);
    expect(result.metadata).toMatchObject({ trafficBreakdownsAvailable: false });
  });

  it("marks traffic unavailable when the V1 traffic store is empty", async () => {
    const rollback = new Error("rollback empty V1 traffic probe");
    let captured: unknown;
    const emptyTrafficDatabase = {
      transaction: async (callback: (transaction: unknown) => Promise<unknown>) => {
        try {
          await database.transaction(async (transaction) => {
            await transaction.delete(websiteAnalyticsSessions);
            captured = await callback(transaction);
            throw rollback;
          });
        } catch (error) {
          if (error !== rollback) throw error;
        }
        return captured;
      },
    } as never;
    const emptyTrafficDashboard = createWebsiteAnalyticsV2Dashboard(emptyTrafficDatabase);
    const result = await emptyTrafficDashboard.load(query(
      `preset=custom&from=${priorDate}&to=${priorDate}&scope=website`,
    ), now);
    expect(result.kpis).toMatchObject({
      visitors: null,
      sessions: null,
      pageViews: 5,
      orders: 1,
    });
    expect(result.channels).toEqual(expect.arrayContaining([
      expect.objectContaining({
        channel: "google_ads",
        visitors: null,
        sessions: null,
        pageViews: 5,
        orders: 1,
      }),
    ]));
    expect(result.metadata).toMatchObject({
      earliestTrafficDate: null,
      trafficCoverageFrom: null,
      trafficMetricsAvailable: false,
      trafficBreakdownsAvailable: false,
    });
    expect(result.pages).toMatchObject({ items: [], available: false, coverageFrom: null });
    expect(result.countries).toEqual([]);
  });

  it("returns retained Visitor and Session metrics as unavailable for an all-time range", async () => {
    const result = await dashboard.load(query("preset=all_time&scope=website"), now);
    expect(result.kpis).toMatchObject({
      visitors: null,
      sessions: null,
      pageViews: 8,
      orders: 2,
      inquiryConversionRate: null,
      orderConversionRate: null,
      paidOrderConversionRate: null,
    });
    expect(result.metadata).toMatchObject({ trafficMetricsAvailable: false });
    expect(result.notices).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "traffic_retention_limited" }),
    ]));
    expect(result.channels).toEqual(expect.arrayContaining([
      expect.objectContaining({
        channel: "google_ads",
        visitors: null,
        sessions: null,
        orders: 1,
      }),
    ]));
    expect(result.campaigns).toEqual(expect.arrayContaining([
      expect.objectContaining({
        campaign: `${prefix}prior-campaign`,
        visitors: null,
        sessions: null,
        orders: 1,
      }),
    ]));
    expect(result.pages).toMatchObject({ items: [], available: false, coverageFrom: priorDate });
    expect(result.countries).toEqual([]);
  });

  it("applies commercial filters without changing Website traffic and returns previous-period KPIs", async () => {
    const filtered = await dashboard.load(query(
      `preset=custom&from=${priorDate}&to=${currentDate}&scope=all_business&market=AU&currency=AUD&granularity=week`,
    ), now);
    expect(filtered.kpis).toMatchObject({
      visitors: 3,
      sessions: 5,
      inquiries: 2,
      orders: 2,
      inquiryConversionRate: 0.4,
      orderConversionRate: 0,
      paidOrderConversionRate: 0,
    });
    expect(filtered.kpis.money).toEqual([{
      currency: "AUD",
      orderedRevenueCents: 50_000,
      collectedRevenueCents: 15_000,
      refundedRevenueCents: 0,
      netCollectedRevenueCents: 15_000,
      orderedAovCents: 25_000,
    }]);
    expect(filtered.funnel).toMatchObject({ scope: "website", sessions: 5, orders: 0 });
    expect(filtered.timeseries).toHaveLength(1);

    const compared = await dashboard.load(query(
      `preset=custom&from=${currentDate}&to=${currentDate}&scope=website&compare=true`,
    ), now);
    expect(compared.comparison).toMatchObject({
      range: { from: priorDate, to: priorDate },
      kpis: { sessions: 3, inquiries: 1, orders: 1, paidOrders: 0 },
    });

    const comparedAllBusiness = await dashboard.load(query(
      `preset=custom&from=${currentDate}&to=${currentDate}&scope=all_business&compare=true`,
    ), now);
    expect(comparedAllBusiness.comparison).toMatchObject({
      range: { from: priorDate, to: priorDate },
      kpis: {
        sessions: 3,
        orders: 2,
        orderConversionRate: 1 / 3,
        paidOrderConversionRate: 0,
      },
    });
  });

  it("returns channel/campaign, payment, page, country and market breakdowns without sentinels drifting", async () => {
    const result = await dashboard.load(query(
      `preset=custom&from=${priorDate}&to=${currentDate}&scope=all_business`,
    ), now);
    expect(result.campaigns).toEqual(expect.arrayContaining([
      expect.objectContaining({ campaign: `${prefix}prior-campaign`, orders: 1 }),
      expect.objectContaining({ campaign: ANALYTICS_DIMENSION_SENTINELS.notSet }),
    ]));
    expect(result.payments).toEqual(expect.arrayContaining([
      { status: "refunded", orders: 1 },
      { status: "partial", orders: 1 },
    ]));
    expect(result.pages.items).toEqual(expect.arrayContaining([
      { pathname: "/shop", visitors: 1, pageViews: 1 },
      { pathname: "/products/task-6", visitors: 1, pageViews: 1 },
    ]));
    expect(result.pages).toMatchObject({ available: true, coverageFrom: priorDate });
    expect(result.countries).toEqual(expect.arrayContaining([
      expect.objectContaining({ countryCode: "NZ" }),
      expect.objectContaining({ countryCode: "AU" }),
    ]));
    expect(result.markets).toEqual(expect.arrayContaining([
      expect.objectContaining({
        market: "NZ", visitors: null, sessions: null, pageViews: null, orders: 2,
      }),
      expect.objectContaining({
        market: "AU", visitors: null, sessions: null, pageViews: null, orders: 2,
      }),
    ]));
  });

  it("paginates and sorts a privacy-safe drill-down with only internal Admin links", async () => {
    const result = await dashboard.listOrders(query(
      `preset=custom&from=${currentDate}&to=${currentDate}&scope=all_business&page=1&pageSize=1&sort=ordered_amount_desc`,
    ));
    expect(result).toMatchObject({ total: 2, page: 1, pageSize: 1, pageCount: 2 });
    expect(result.items[0]).toMatchObject({
      reference: references.jobParent.jobNumber,
      source: "manual",
      currency: "AUD",
      orderedAmountCents: 30_000,
      collectedAmountCents: 10_000,
      refundedAmountCents: 0,
      netCollectedAmountCents: 10_000,
      paymentStatus: "partial",
      adminHref: `/admin/jobs/${references.jobParent.id}`,
      attribution: {
        channel: ANALYTICS_DIMENSION_SENTINELS.manualOffline,
        source: ANALYTICS_DIMENSION_SENTINELS.manualOffline,
        medium: ANALYTICS_DIMENSION_SENTINELS.notSet,
        campaign: ANALYTICS_DIMENSION_SENTINELS.notSet,
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/customer|email|phone|address|message|click|visitor|session/i);

    const website = await dashboard.listOrders(query(
      `preset=custom&from=${currentDate}&to=${currentDate}&scope=website&page=1&pageSize=25&sort=occurred_at_desc`,
    ));
    expect(website.items).toHaveLength(1);
    expect(website.items[0]).toMatchObject({
      reference: references.orderParent.orderNumber,
      adminHref: `/admin/orders/${references.orderParent.id}`,
      source: "website",
    });
  });
});
