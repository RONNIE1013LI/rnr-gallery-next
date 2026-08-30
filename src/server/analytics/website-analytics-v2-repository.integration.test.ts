import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  checkoutSessions,
  customerServiceConversations,
  orders,
  productionJobs,
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
const checkoutSessionIds: string[] = [];
const orderIds: string[] = [];
const productionJobIds: string[] = [];
const conversationIds: string[] = [];
const dirtyDates = [
  "2097-01-01", "2097-01-02", "2097-01-03", "2097-01-04",
  "2097-02-01", "2097-02-03", "2097-03-01", "2097-03-03",
  "2097-04-01", "2097-04-03",
];

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const sourceId = (value: string) => `${sourcePrefix}${value}`;

async function createOrder(totalCents = 10_000) {
  const [session] = await database.insert(checkoutSessions).values({
    tokenDigest: digest(sourceId(`checkout:${randomUUID()}`)),
    expiresAt: new Date("2098-01-01T00:00:00.000Z"),
    completedAt: new Date("2097-01-01T00:00:00.000Z"),
  }).returning({ id: checkoutSessions.id });
  checkoutSessionIds.push(session!.id);
  const [order] = await database.insert(orders).values({
    orderNumber: `RNR-A3-${randomUUID().replaceAll("-", "").slice(0, 10)}`,
    checkoutSessionId: session!.id,
    checkoutSessionVersion: 1,
    idempotencyKey: randomUUID(),
    customerEmail: "analytics-task3@example.test",
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
      productSubtotalExTaxCents: totalCents,
      productTaxCents: 0,
      productTotalInclTaxCents: totalCents,
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
      finalTotalCents: totalCents,
    },
    deliveryMethod: "pickup",
    shippingServiceCode: "pickup",
    shippingServiceName: "Pickup",
    productSubtotalExGstCents: totalCents,
    productGstCents: 0,
    productTotalInclGstCents: totalCents,
    shippingExGstCents: 0,
    shippingGstCents: 0,
    shippingTotalInclGstCents: 0,
    totalExGstCents: totalCents,
    totalGstCents: 0,
    totalInclGstCents: totalCents,
  }).returning({ id: orders.id });
  orderIds.push(order!.id);
  return order!.id;
}

async function createProductionJob() {
  const id = randomUUID();
  await database.insert(productionJobs).values({
    id,
    jobNumber: `A3-${randomUUID().replaceAll("-", "").slice(0, 10)}`,
    source: "manual",
    idempotencyKey: randomUUID(),
    requestDigest: digest(randomUUID()),
    customerName: "Analytics Task 3",
    customerEmail: "analytics-task3@example.test",
    customerPhone: "",
    customerSource: "web",
    manualStatus: "new",
    manualPaymentStatus: "awaiting_payment",
    neededDate: "2097-01-10",
    deliveryMethod: "pickup",
    amountPayableCents: 10_000,
    amountPaidCents: 0,
    artistFeeCents: 0,
    materialCostCents: 0,
  });
  productionJobIds.push(id);
  return id;
}

async function createConversation() {
  const [conversation] = await database.insert(customerServiceConversations).values({
    channel: "website",
    externalKeyHash: digest(sourceId(`conversation:${randomUUID()}`)),
  }).returning({ id: customerServiceConversations.id });
  conversationIds.push(conversation!.id);
  return conversation!.id;
}

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
  if (conversationIds.length > 0) {
    await database.delete(customerServiceConversations)
      .where(inArray(customerServiceConversations.id, conversationIds));
  }
  if (productionJobIds.length > 0) {
    await database.delete(productionJobs).where(inArray(productionJobs.id, productionJobIds));
  }
  if (orderIds.length > 0) {
    await database.delete(orders).where(inArray(orders.id, orderIds));
  }
  if (checkoutSessionIds.length > 0) {
    await database.delete(checkoutSessions).where(inArray(checkoutSessions.id, checkoutSessionIds));
  }
  await pool.end();
});

describe("website analytics V2 repository", () => {
  it("keeps an order and its attribution snapshot immutable on a duplicate source ID", async () => {
    const repository = createWebsiteAnalyticsV2Repository(database, { attributionLookbackDays: 90 });
    const orderId = await createOrder(12_500);
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
      orderId,
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
    await database.update(websiteAnalyticsReconciliationState).set({
      status: "completed",
      startedAt: new Date("2097-01-02T00:00:00.000Z"),
      completedAt: new Date("2097-01-02T00:01:00.000Z"),
    }).where(and(
      eq(websiteAnalyticsReconciliationState.stateType, "dirty_date"),
      eq(websiteAnalyticsReconciliationState.stateKey, "2097-01-01"),
    ));
    expect(await repository.recordOrder(input)).toEqual({ created: false, factId: first.factId });
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
    expect(await database.select({
      stateKey: websiteAnalyticsReconciliationState.stateKey,
      status: websiteAnalyticsReconciliationState.status,
    }).from(websiteAnalyticsReconciliationState).where(and(
      eq(websiteAnalyticsReconciliationState.stateType, "dirty_date"),
      inArray(websiteAnalyticsReconciliationState.stateKey, ["2097-01-01", "2097-01-03"]),
    ))).toEqual([{ stateKey: "2097-01-01", status: "completed" }]);
  });

  it("races distinct valid order snapshots and persists exactly one complete winner and dirty date", async () => {
    const repository = createWebsiteAnalyticsV2Repository(database);
    const orderId = await createOrder(7_500);
    const firstVisitor = digest(sourceId("concurrent-first-visitor"));
    const secondVisitor = digest(sourceId("concurrent-second-visitor"));
    const firstSessionId = await insertSession({
      visitorDigest: firstVisitor,
      startedAt: new Date("2097-01-31T00:00:00.000Z"),
      channel: "google_ads",
      source: "google",
      campaign: "concurrent-first",
    });
    const secondSessionId = await insertSession({
      visitorDigest: secondVisitor,
      startedAt: new Date("2097-02-02T00:00:00.000Z"),
      channel: "meta_ads",
      source: "facebook",
      campaign: "concurrent-second",
    });
    const firstInput = {
      source: "website" as const,
      sourceId: sourceId("concurrent-order"),
      orderId,
      occurredAt: new Date("2097-02-01T00:00:00.000Z"),
      market: "NZ" as const,
      currency: "NZD" as const,
      orderedAmountInclGstCents: 7_500,
      consentLinked: true,
      visitorDigest: firstVisitor,
      convertingSessionId: firstSessionId,
    };
    const secondInput = {
      ...firstInput,
      occurredAt: new Date("2097-02-03T00:00:00.000Z"),
      orderedAmountInclGstCents: 8_800,
      visitorDigest: secondVisitor,
      convertingSessionId: secondSessionId,
    };
    const results = await Promise.all([
      repository.recordOrder(firstInput),
      repository.recordOrder(secondInput),
    ]);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.factId))).toHaveLength(1);

    const [winner] = await database.select({
      id: websiteAnalyticsConversions.id,
      amount: websiteAnalyticsConversions.orderedAmountInclGstCents,
      localDate: websiteAnalyticsConversions.localDate,
      visitorDigest: websiteAnalyticsConversions.visitorDigest,
      convertingSessionId: websiteAnalyticsConversions.convertingSessionId,
    }).from(websiteAnalyticsConversions)
      .where(eq(websiteAnalyticsConversions.sourceId, firstInput.sourceId));
    const expected = winner!.amount === 7_500
      ? { localDate: "2097-02-01", visitorDigest: firstVisitor, sessionId: firstSessionId, campaign: "concurrent-first" }
      : { localDate: "2097-02-03", visitorDigest: secondVisitor, sessionId: secondSessionId, campaign: "concurrent-second" };
    expect(winner).toMatchObject({
      localDate: expected.localDate,
      visitorDigest: expected.visitorDigest,
      convertingSessionId: expected.sessionId,
    });
    expect(await database.select({
      sessionId: websiteAnalyticsAttributionSnapshots.sessionId,
      campaign: websiteAnalyticsAttributionSnapshots.campaign,
    }).from(websiteAnalyticsAttributionSnapshots)
      .where(eq(websiteAnalyticsAttributionSnapshots.conversionId, winner!.id)))
      .toEqual([
        { sessionId: expected.sessionId, campaign: expected.campaign },
        { sessionId: expected.sessionId, campaign: expected.campaign },
      ]);
    expect(await database.select({ stateKey: websiteAnalyticsReconciliationState.stateKey })
      .from(websiteAnalyticsReconciliationState).where(and(
        eq(websiteAnalyticsReconciliationState.stateType, "dirty_date"),
        inArray(websiteAnalyticsReconciliationState.stateKey, ["2097-02-01", "2097-02-03"]),
      ))).toEqual([{ stateKey: expected.localDate }]);
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

  it("persists real authoritative parents for current manual orders and inquiries", async () => {
    const repository = createWebsiteAnalyticsV2Repository(database);
    const productionJobId = await createProductionJob();
    const conversationId = await createConversation();
    const manual = await repository.recordOrder({
      source: "manual",
      sourceId: sourceId("current-manual-order"),
      productionJobId,
      occurredAt: new Date("2097-01-03T02:00:00.000Z"),
      market: "NZ",
      currency: "NZD",
      orderedAmountInclGstCents: 10_000,
    });
    const inquiry = await repository.recordInquiry({
      sourceId: sourceId("current-inquiry"),
      conversationId,
      occurredAt: new Date("2097-01-03T03:00:00.000Z"),
      consentLinked: false,
    });
    const financial = await repository.recordFinancialEvent({
      productionJobId,
      eventType: "receipt",
      sourceType: "manual_payment_update",
      sourceId: sourceId("current-manual-receipt"),
      amountCents: 1_000,
      currency: "NZD",
      occurredAt: new Date("2097-01-03T04:00:00.000Z"),
    });

    expect(await database.select({
      factId: websiteAnalyticsConversions.id,
      productionJobId: websiteAnalyticsConversions.productionJobId,
      conversationId: websiteAnalyticsConversions.conversationId,
    }).from(websiteAnalyticsConversions)
      .where(inArray(websiteAnalyticsConversions.id, [manual.factId, inquiry.factId]))
      .orderBy(asc(websiteAnalyticsConversions.id))).toEqual(expect.arrayContaining([
      { factId: manual.factId, productionJobId, conversationId: null },
      { factId: inquiry.factId, productionJobId: null, conversationId },
    ]));
    expect(await database.select({
      eventId: websiteAnalyticsFinancialEvents.id,
      orderId: websiteAnalyticsFinancialEvents.orderId,
      productionJobId: websiteAnalyticsFinancialEvents.productionJobId,
    }).from(websiteAnalyticsFinancialEvents)
      .where(eq(websiteAnalyticsFinancialEvents.id, financial.eventId))).toEqual([{
      eventId: financial.eventId,
      orderId: null,
      productionJobId,
    }]);
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
    const orderId = await createOrder(10_000);
    const events = [
      { orderId, eventType: "receipt" as const, sourceType: "payment_ledger_entry" as const, sourceId: sourceId("receipt-1"), amountCents: 4_000, currency: "NZD" as const, occurredAt: new Date("2097-01-01T01:00:00.000Z") },
      { orderId, eventType: "receipt" as const, sourceType: "payment_ledger_entry" as const, sourceId: sourceId("receipt-2"), amountCents: 6_000, currency: "NZD" as const, occurredAt: new Date("2097-01-01T02:00:00.000Z") },
      { orderId, eventType: "refund" as const, sourceType: "payment_provider_event" as const, sourceId: sourceId("refund-full"), amountCents: 10_000, currency: "NZD" as const, occurredAt: new Date("2097-01-02T01:00:00.000Z") },
      { orderId, eventType: "refund" as const, sourceType: "payment_ledger_entry" as const, sourceId: sourceId("refund-partial"), amountCents: 2_500, currency: "AUD" as const, occurredAt: new Date("2097-01-02T02:00:00.000Z") },
    ];
    for (const event of events) expect(await repository.recordFinancialEvent(event)).toMatchObject({ created: true });
    expect(await repository.recordFinancialEvent(events[2]!)).toMatchObject({ created: false });

    const rows = await database.select({
      eventType: websiteAnalyticsFinancialEvents.eventType,
      amountCents: websiteAnalyticsFinancialEvents.amountCents,
      currency: websiteAnalyticsFinancialEvents.currency,
    }).from(websiteAnalyticsFinancialEvents)
      .where(inArray(websiteAnalyticsFinancialEvents.sourceId, events.map((event) => event.sourceId)))
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

  it("keeps a financial winner and completed dirty state immutable across exact and mutated retries", async () => {
    const repository = createWebsiteAnalyticsV2Repository(database);
    const firstOrderId = await createOrder(4_000);
    const replacementOrderId = await createOrder(9_999);
    const input = {
      orderId: firstOrderId,
      eventType: "receipt" as const,
      sourceType: "payment_attempt" as const,
      sourceId: sourceId("immutable-financial"),
      amountCents: 4_000,
      currency: "NZD" as const,
      occurredAt: new Date("2097-03-01T00:00:00.000Z"),
    };
    const first = await repository.recordFinancialEvent(input);
    await database.update(websiteAnalyticsReconciliationState).set({
      status: "completed",
      startedAt: new Date("2097-03-02T00:00:00.000Z"),
      completedAt: new Date("2097-03-02T00:01:00.000Z"),
    }).where(and(
      eq(websiteAnalyticsReconciliationState.stateType, "dirty_date"),
      eq(websiteAnalyticsReconciliationState.stateKey, "2097-03-01"),
    ));
    expect(await repository.recordFinancialEvent(input))
      .toEqual({ created: false, eventId: first.eventId });
    expect(await repository.recordFinancialEvent({
      ...input,
      orderId: replacementOrderId,
      amountCents: 9_999,
      currency: "AUD",
      occurredAt: new Date("2097-03-03T00:00:00.000Z"),
    })).toEqual({ created: false, eventId: first.eventId });

    expect(await database.select({
      id: websiteAnalyticsFinancialEvents.id,
      orderId: websiteAnalyticsFinancialEvents.orderId,
      amountCents: websiteAnalyticsFinancialEvents.amountCents,
      currency: websiteAnalyticsFinancialEvents.currency,
      occurredAt: websiteAnalyticsFinancialEvents.occurredAt,
      localDate: websiteAnalyticsFinancialEvents.localDate,
    }).from(websiteAnalyticsFinancialEvents)
      .where(eq(websiteAnalyticsFinancialEvents.id, first.eventId))).toEqual([{
      id: first.eventId,
      orderId: firstOrderId,
      amountCents: 4_000,
      currency: "NZD",
      occurredAt: input.occurredAt,
      localDate: "2097-03-01",
    }]);
    expect(await database.select({
      stateKey: websiteAnalyticsReconciliationState.stateKey,
      status: websiteAnalyticsReconciliationState.status,
    }).from(websiteAnalyticsReconciliationState).where(and(
      eq(websiteAnalyticsReconciliationState.stateType, "dirty_date"),
      inArray(websiteAnalyticsReconciliationState.stateKey, ["2097-03-01", "2097-03-03"]),
    ))).toEqual([{ stateKey: "2097-03-01", status: "completed" }]);
  });

  it("races distinct financial payloads and persists exactly one immutable winner and dirty date", async () => {
    const repository = createWebsiteAnalyticsV2Repository(database);
    const firstOrderId = await createOrder(3_000);
    const secondOrderId = await createOrder(7_000);
    const firstInput = {
      orderId: firstOrderId,
      eventType: "receipt" as const,
      sourceType: "payment_provider_event" as const,
      sourceId: sourceId("concurrent-financial"),
      amountCents: 3_000,
      currency: "NZD" as const,
      occurredAt: new Date("2097-04-01T00:00:00.000Z"),
    };
    const secondInput = {
      ...firstInput,
      orderId: secondOrderId,
      amountCents: 7_000,
      currency: "AUD" as const,
      occurredAt: new Date("2097-04-03T00:00:00.000Z"),
    };
    const results = await Promise.all([
      repository.recordFinancialEvent(firstInput),
      repository.recordFinancialEvent(secondInput),
    ]);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.eventId))).toHaveLength(1);

    const [winner] = await database.select({
      id: websiteAnalyticsFinancialEvents.id,
      orderId: websiteAnalyticsFinancialEvents.orderId,
      amountCents: websiteAnalyticsFinancialEvents.amountCents,
      currency: websiteAnalyticsFinancialEvents.currency,
      localDate: websiteAnalyticsFinancialEvents.localDate,
    }).from(websiteAnalyticsFinancialEvents)
      .where(eq(websiteAnalyticsFinancialEvents.sourceId, firstInput.sourceId));
    const expected = winner!.amountCents === 3_000
      ? { orderId: firstOrderId, currency: "NZD", localDate: "2097-04-01" }
      : { orderId: secondOrderId, currency: "AUD", localDate: "2097-04-03" };
    expect(winner).toMatchObject(expected);
    expect(await database.select({ stateKey: websiteAnalyticsReconciliationState.stateKey })
      .from(websiteAnalyticsReconciliationState).where(and(
        eq(websiteAnalyticsReconciliationState.stateType, "dirty_date"),
        inArray(websiteAnalyticsReconciliationState.stateKey, ["2097-04-01", "2097-04-03"]),
      ))).toEqual([{ stateKey: expected.localDate }]);
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
    const conversationId = await createConversation();
    await expect(database.transaction(async (transaction) => {
      await repository.recordInquiry({
        sourceId: transactionalSource,
        conversationId,
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
