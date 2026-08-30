import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  adminAuditLogs,
  checkoutSessions,
  customerServiceConversations,
  customerServiceMessages,
  orders,
  paymentAttempts,
  paymentLedgerEntries,
  productionJobs,
  websiteAnalyticsAttributionSnapshots,
  websiteAnalyticsConversions,
  websiteAnalyticsFinancialEvents,
  websiteAnalyticsReconciliationState,
} from "@/server/db/schema";
import { createDrizzlePaymentRepository } from "@/server/payments/drizzle-payment-repository";
import { createWebsiteAnalyticsV2Backfill } from "./website-analytics-v2-backfill";
import { createWebsiteAnalyticsV2Reconciliation } from "./website-analytics-v2-reconciliation";
import { createWebsiteAnalyticsV2Repository } from "./website-analytics-v2-repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");
const identity = new URL(testDatabaseUrl);
if (!new Set(["127.0.0.1", "localhost"]).has(identity.hostname)
  || identity.pathname !== "/rnr_website_analytics_test") {
  throw new Error("The local rnr website analytics Test database is required");
}

const pool = new Pool({ connectionString: testDatabaseUrl });
const database = drizzle(pool);
const runId = randomUUID();
const prefix = `analytics-v2-task5:${runId}:`;
const sourceIds: string[] = [];
const checkoutIds: string[] = [];
const orderIds: string[] = [];
const jobIds: string[] = [];
const conversationIds: string[] = [];
const messageIds: string[] = [];
const attemptIds: string[] = [];
const ledgerIds: string[] = [];

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

async function websiteOrder(input: Readonly<{
  id?: string;
  occurredAt: Date;
  amountCents?: number;
  market?: "NZ" | "AU";
  paymentStatus?: "awaiting_payment" | "paid" | "refunded";
}>) {
  const id = input.id ?? randomUUID();
  const market = input.market ?? "NZ";
  const currency = market === "AU" ? "AUD" : "NZD";
  const amountCents = input.amountCents ?? 10_000;
  const [checkout] = await database.insert(checkoutSessions).values({
    tokenDigest: digest(`${prefix}checkout:${id}`),
    expiresAt: new Date("2401-01-01T00:00:00.000Z"),
    completedAt: input.occurredAt,
  }).returning({ id: checkoutSessions.id });
  checkoutIds.push(checkout!.id);
  await database.insert(orders).values({
    id,
    orderNumber: `RNR-A5-${runId.replaceAll("-", "").slice(0, 8)}-${id.replaceAll("-", "").slice(-8)}`,
    checkoutSessionId: checkout!.id,
    checkoutSessionVersion: 1,
    idempotencyKey: `${prefix}order:${id}`,
    customerEmail: "analytics-task5@example.test",
    market,
    currency,
    taxJurisdiction: market === "AU" ? "AU_GST" : "NZ_GST",
    taxRateBasisPoints: 0,
    pricingSnapshot: {
      schemaVersion: 1,
      market,
      currency,
      priceBookRevision: 0,
      taxJurisdiction: market === "AU" ? "AU_GST" : "NZ_GST",
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
        currency,
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
    paymentStatus: input.paymentStatus ?? "awaiting_payment",
    createdAt: input.occurredAt,
    updatedAt: new Date(input.occurredAt.getTime() + 86_400_000),
  });
  orderIds.push(id);
  const jobId = randomUUID();
  await database.insert(productionJobs).values({
    id: jobId,
    jobNumber: `A5-WEB-${jobId.replaceAll("-", "").slice(0, 10)}`,
    source: "web",
    orderId: id,
    customerName: "Analytics Task 5",
    customerEmail: "analytics-task5@example.test",
    customerPhone: "",
    customerSource: "web",
    neededDate: "2400-01-01",
    deliveryMethod: "pickup",
    createdAt: input.occurredAt,
  });
  jobIds.push(jobId);
  return id;
}

async function websiteInquiry(occurredAt: Date) {
  const conversationId = randomUUID();
  const messageId = randomUUID();
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
    body: "Task 5 test inquiry",
    receivedAt: occurredAt,
    createdAt: occurredAt,
  });
  conversationIds.push(conversationId);
  messageIds.push(messageId);
  return conversationId;
}

async function manualOrder(occurredAt: Date) {
  const id = randomUUID();
  await database.insert(productionJobs).values({
    id,
    jobNumber: `A5-MAN-${id.replaceAll("-", "").slice(0, 10)}`,
    source: "manual",
    idempotencyKey: `${prefix}manual:${id}`,
    requestDigest: digest(`${prefix}manual:${id}`),
    customerName: "Analytics Task 5",
    customerEmail: "analytics-task5@example.test",
    customerPhone: "",
    customerSource: "web",
    manualStatus: "new",
    manualPaymentStatus: "paid",
    manualPaymentConfirmedAt: new Date(occurredAt.getTime() + 86_400_000),
    neededDate: "2400-01-01",
    deliveryMethod: "pickup",
    amountPayableCents: 15_000,
    amountPaidCents: 15_000,
    artistFeeCents: 0,
    materialCostCents: 0,
    createdAt: occurredAt,
  });
  jobIds.push(id);
  return id;
}

afterAll(async () => {
  await database.delete(websiteAnalyticsFinancialEvents)
    .where(sql`${websiteAnalyticsFinancialEvents.sourceId} like ${`${prefix}%`}`);
  if (sourceIds.length > 0) {
    await database.delete(websiteAnalyticsConversions)
      .where(inArray(websiteAnalyticsConversions.sourceId, sourceIds));
  }
  await database.delete(websiteAnalyticsReconciliationState)
    .where(sql`${websiteAnalyticsReconciliationState.stateKey} like ${`${prefix}%`}`);
  if (jobIds.length > 0) {
    await database.delete(adminAuditLogs).where(and(
      eq(adminAuditLogs.resourceType, "production_job"),
      inArray(adminAuditLogs.resourceId, jobIds),
    ));
  }
  if (ledgerIds.length > 0) {
    await database.delete(paymentLedgerEntries).where(inArray(paymentLedgerEntries.id, ledgerIds));
  }
  if (attemptIds.length > 0) {
    await database.delete(paymentAttempts).where(inArray(paymentAttempts.id, attemptIds));
  }
  if (messageIds.length > 0) {
    await database.delete(customerServiceMessages).where(inArray(customerServiceMessages.id, messageIds));
  }
  if (conversationIds.length > 0) {
    await database.delete(customerServiceConversations)
      .where(inArray(customerServiceConversations.id, conversationIds));
  }
  if (jobIds.length > 0) {
    await database.delete(productionJobs).where(inArray(productionJobs.id, jobIds));
  }
  if (orderIds.length > 0) {
    await database.delete(orders).where(inArray(orders.id, orderIds));
  }
  if (checkoutIds.length > 0) {
    await database.delete(checkoutSessions).where(inArray(checkoutSessions.id, checkoutIds));
  }
  await pool.end();
});

describe("website analytics V2 backfill", () => {
  it("keeps dry-run write-free and resumes stable multi-year chunks as historical unattributed facts", async () => {
    const firstId = randomUUID();
    const secondId = randomUUID();
    await websiteOrder({ id: secondId, occurredAt: new Date("2299-01-01T00:00:00.000Z") });
    await websiteOrder({ id: firstId, occurredAt: new Date("2288-01-01T00:00:00.000Z") });
    sourceIds.push(firstId, secondId);
    const stateKeyPrefix = `${prefix}bounded`;
    const backfill = createWebsiteAnalyticsV2Backfill(database);

    const dryRun = await backfill.run({
      dryRun: true,
      batchSize: 1,
      sources: ["website_orders"],
      stateKeyPrefix,
      fromOccurredAt: new Date("2288-01-01T00:00:00.000Z"),
    });
    expect(dryRun.totals).toMatchObject({ scanned: 1, created: 0, wouldCreate: 1, failed: 0 });
    expect(dryRun.sources[0]).toMatchObject({
      source: "website_orders",
      cursor: { occurredAt: "2288-01-01T00:00:00.000Z", id: firstId },
      complete: false,
    });
    expect(await database.select().from(websiteAnalyticsConversions)
      .where(inArray(websiteAnalyticsConversions.sourceId, [firstId, secondId]))).toEqual([]);
    expect(await database.select().from(websiteAnalyticsReconciliationState)
      .where(sql`${websiteAnalyticsReconciliationState.stateKey} like ${`${stateKeyPrefix}%`}`))
      .toEqual([]);

    const first = await backfill.run({
      dryRun: false,
      batchSize: 1,
      sources: ["website_orders"],
      stateKeyPrefix,
      fromOccurredAt: new Date("2288-01-01T00:00:00.000Z"),
    });
    const second = await backfill.run({
      dryRun: false,
      batchSize: 1,
      sources: ["website_orders"],
      stateKeyPrefix,
      fromOccurredAt: new Date("2288-01-01T00:00:00.000Z"),
    });
    const rerun = await backfill.run({
      dryRun: false,
      batchSize: 1,
      sources: ["website_orders"],
      stateKeyPrefix,
      fromOccurredAt: new Date("2288-01-01T00:00:00.000Z"),
    });
    expect(first.totals).toMatchObject({ scanned: 1, created: 1, failed: 0 });
    expect(second.totals).toMatchObject({ scanned: 1, created: 1, failed: 0 });
    expect(second.sources[0]?.complete).toBe(true);
    expect(rerun.totals).toMatchObject({ scanned: 0, created: 0, unchanged: 0, failed: 0 });

    const facts = await database.select({
      id: websiteAnalyticsConversions.id,
      sourceId: websiteAnalyticsConversions.sourceId,
      historical: websiteAnalyticsConversions.historical,
      consentLinked: websiteAnalyticsConversions.consentLinked,
      visitorDigest: websiteAnalyticsConversions.visitorDigest,
    }).from(websiteAnalyticsConversions)
      .where(inArray(websiteAnalyticsConversions.sourceId, [firstId, secondId]));
    expect(facts).toHaveLength(2);
    expect(facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: firstId, historical: true, consentLinked: false, visitorDigest: null }),
      expect.objectContaining({ sourceId: secondId, historical: true, consentLinked: false, visitorDigest: null }),
    ]));
    expect(await database.select({
      channel: websiteAnalyticsAttributionSnapshots.channel,
      source: websiteAnalyticsAttributionSnapshots.source,
    }).from(websiteAnalyticsAttributionSnapshots)
      .where(inArray(websiteAnalyticsAttributionSnapshots.conversionId, facts.map((fact) => fact.id))))
      .toEqual([
        { channel: "unattributed", source: "Unattributed" },
        { channel: "unattributed", source: "Unattributed" },
        { channel: "unattributed", source: "Unattributed" },
        { channel: "unattributed", source: "Unattributed" },
      ]);
  });

  it("retries a crashed row without skipping it and lets only one concurrent worker create it", async () => {
    const orderId = await websiteOrder({ occurredAt: new Date("2298-05-02T01:00:00.000Z") });
    sourceIds.push(orderId);
    const realRepository = createWebsiteAnalyticsV2Repository(database);
    let failOnce = true;
    const repository = {
      ...realRepository,
      async recordOrder(...args: Parameters<typeof realRepository.recordOrder>) {
        if (failOnce) {
          failOnce = false;
          throw new Error("controlled crash");
        }
        return realRepository.recordOrder(...args);
      },
    };
    const stateKeyPrefix = `${prefix}crash`;
    const backfill = createWebsiteAnalyticsV2Backfill(database, { repository });

    const failed = await backfill.run({
      dryRun: false,
      batchSize: 1,
      sources: ["website_orders"],
      stateKeyPrefix,
      fromOccurredAt: new Date("2298-05-01T00:00:00.000Z"),
    });
    expect(failed.totals).toMatchObject({ scanned: 0, created: 0, failed: 1 });
    expect(await database.select().from(websiteAnalyticsConversions)
      .where(eq(websiteAnalyticsConversions.sourceId, orderId))).toEqual([]);
    const [failedState] = await database.select({
      status: websiteAnalyticsReconciliationState.status,
      cursorOccurredAt: websiteAnalyticsReconciliationState.cursorOccurredAt,
      cursorId: websiteAnalyticsReconciliationState.cursorId,
      failedCount: websiteAnalyticsReconciliationState.failedCount,
      lastErrorCode: websiteAnalyticsReconciliationState.lastErrorCode,
    }).from(websiteAnalyticsReconciliationState).where(and(
      eq(websiteAnalyticsReconciliationState.stateType, "backfill"),
      eq(websiteAnalyticsReconciliationState.stateKey, `${stateKeyPrefix}:website_orders`),
    ));
    expect(failedState).toEqual({
      status: "failed",
      cursorOccurredAt: new Date("2298-05-01T00:00:00.000Z"),
      cursorId: "00000000-0000-0000-0000-000000000000",
      failedCount: 1,
      lastErrorCode: "SOURCE_ROW_FAILED",
    });
    expect(JSON.stringify(failedState)).not.toContain("controlled crash");

    const results = await Promise.all([
      backfill.run({
        dryRun: false,
        batchSize: 1,
        sources: ["website_orders"],
        stateKeyPrefix,
        fromOccurredAt: new Date("2298-05-01T00:00:00.000Z"),
      }),
      backfill.run({
        dryRun: false,
        batchSize: 1,
        sources: ["website_orders"],
        stateKeyPrefix,
        fromOccurredAt: new Date("2298-05-01T00:00:00.000Z"),
      }),
    ]);
    expect(results.reduce((sum, result) => sum + result.totals.created, 0)).toBe(1);
    expect(await database.select().from(websiteAnalyticsConversions)
      .where(eq(websiteAnalyticsConversions.sourceId, orderId))).toHaveLength(1);
  });

  it("imports exact ledger and durable direct transitions while skipping mutable paid/refund status inference", async () => {
    const mutableOnly = await websiteOrder({
      occurredAt: new Date("2298-06-01T00:00:00.000Z"),
      paymentStatus: "refunded",
    });
    const exactOrder = await websiteOrder({
      occurredAt: new Date("2298-06-02T00:00:00.000Z"),
      amountCents: 12_000,
    });
    sourceIds.push(mutableOnly, exactOrder);
    const ledgerId = `${prefix}ledger`;
    await database.insert(paymentLedgerEntries).values({
      id: randomUUID(),
      orderId: exactOrder,
      entryType: "bank_transfer",
      direction: "credit",
      amountCents: 4_000,
      currency: "NZD",
      receivedAt: new Date("2298-06-03T01:02:03.000Z"),
      idempotencyKey: ledgerId,
    }).then((rows) => rows);
    const [ledger] = await database.select({ id: paymentLedgerEntries.id })
      .from(paymentLedgerEntries)
      .where(eq(paymentLedgerEntries.idempotencyKey, ledgerId));
    ledgerIds.push(ledger!.id);
    const attemptId = randomUUID();
    attemptIds.push(attemptId);
    await database.insert(paymentAttempts).values({
      id: attemptId,
      orderId: exactOrder,
      provider: "local-test",
      method: "card",
      idempotencyKey: `${prefix}attempt`,
      expectedAmountCents: 12_000,
      currency: "NZD",
      country: "NZ",
      status: "paid",
      websiteAnalyticsPaidAt: new Date("2298-06-04T00:00:00.000Z"),
      websiteAnalyticsRefundedAt: new Date("2298-06-05T00:00:00.000Z"),
    });
    const legacyDirectLedgerId = randomUUID();
    const legacyBackfillLedgerId = randomUUID();
    ledgerIds.push(legacyDirectLedgerId, legacyBackfillLedgerId);
    await database.insert(paymentLedgerEntries).values([
      {
        id: legacyDirectLedgerId,
        orderId: exactOrder,
        paymentAttemptId: attemptId,
        entryType: "online_payment",
        direction: "credit",
        amountCents: 12_000,
        currency: "NZD",
        receivedAt: new Date("2298-06-02T12:00:00.000Z"),
        reference: "legacy verified payment attempt",
      },
      {
        id: legacyBackfillLedgerId,
        orderId: exactOrder,
        entryType: "legacy_backfill",
        direction: "credit",
        amountCents: 12_000,
        currency: "NZD",
        receivedAt: new Date("2298-06-02T13:00:00.000Z"),
        reference: "legacy paid order backfill",
      },
    ]);
    const paymentRepository = createDrizzlePaymentRepository(database, {
      websiteAnalyticsV2Enabled: true,
    });
    const backfill = createWebsiteAnalyticsV2Backfill(database, {
      loadDirectTransitions: (id) => paymentRepository
        .loadWebsiteAnalyticsDirectPaymentTransitions(id),
    });

    const preview = await backfill.run({
      dryRun: true,
      batchSize: 20,
      sources: ["ledger_events"],
      stateKeyPrefix: `${prefix}finance-preview`,
      fromOccurredAt: new Date("2298-06-01T00:00:00.000Z"),
    });
    expect(preview.totals).toMatchObject({
      scanned: 3,
      wouldCreate: 1,
      unchanged: 0,
      skipped: 2,
      failed: 0,
    });

    const result = await backfill.run({
      dryRun: false,
      batchSize: 20,
      sources: [
        "ledger_events",
        "direct_payment_paid_transitions",
        "direct_payment_refund_transitions",
      ],
      stateKeyPrefix: `${prefix}finance`,
      fromOccurredAt: new Date("2298-06-01T00:00:00.000Z"),
    });
    expect(result.totals).toMatchObject({ created: 3, failed: 0 });
    expect(result.limitations).toEqual(expect.arrayContaining([
      expect.stringMatching(/mutable.*payment.*status/i),
      expect.stringMatching(/mutable.*refund.*status/i),
      expect.stringMatching(/legacy.*ledger.*skipped/i),
    ]));
    expect(await database.select({
      sourceType: websiteAnalyticsFinancialEvents.sourceType,
      sourceId: websiteAnalyticsFinancialEvents.sourceId,
      eventType: websiteAnalyticsFinancialEvents.eventType,
      amountCents: websiteAnalyticsFinancialEvents.amountCents,
      occurredAt: websiteAnalyticsFinancialEvents.occurredAt,
    }).from(websiteAnalyticsFinancialEvents).where(and(
      inArray(websiteAnalyticsFinancialEvents.sourceType, ["payment_ledger_entry", "payment_attempt"]),
      inArray(websiteAnalyticsFinancialEvents.sourceId, [ledger!.id, attemptId]),
    ))).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceType: "payment_ledger_entry", sourceId: ledger!.id, eventType: "receipt", amountCents: 4_000, occurredAt: new Date("2298-06-03T01:02:03.000Z") }),
      expect.objectContaining({ sourceType: "payment_attempt", sourceId: attemptId, eventType: "receipt", amountCents: 12_000, occurredAt: new Date("2298-06-04T00:00:00.000Z") }),
      expect.objectContaining({ sourceType: "payment_attempt", sourceId: attemptId, eventType: "refund", amountCents: 12_000, occurredAt: new Date("2298-06-05T00:00:00.000Z") }),
    ]));
    expect(await database.select().from(websiteAnalyticsFinancialEvents)
      .where(eq(websiteAnalyticsFinancialEvents.orderId, mutableOnly))).toEqual([]);
    expect(await database.select().from(websiteAnalyticsFinancialEvents)
      .where(inArray(websiteAnalyticsFinancialEvents.sourceId, [
        legacyDirectLedgerId,
        legacyBackfillLedgerId,
      ]))).toEqual([]);
  });

  it("repairs a recent durable refund without replaying an older paid transition", async () => {
    const orderId = await websiteOrder({
      occurredAt: new Date("2298-09-01T00:00:00.000Z"),
      amountCents: 9_000,
    });
    sourceIds.push(orderId);
    const repository = createWebsiteAnalyticsV2Repository(database);
    await repository.recordOrder({
      source: "website",
      sourceId: orderId,
      orderId,
      occurredAt: new Date("2298-09-01T00:00:00.000Z"),
      market: "NZ",
      currency: "NZD",
      orderedAmountInclGstCents: 9_000,
      historical: false,
      consentLinked: false,
    });
    const attemptId = randomUUID();
    attemptIds.push(attemptId);
    const paidAt = new Date("2298-09-01T01:00:00.000Z");
    const refundedAt = new Date("2298-10-10T01:00:00.000Z");
    await database.insert(paymentAttempts).values({
      id: attemptId,
      orderId,
      provider: "local-test",
      method: "card",
      idempotencyKey: `${prefix}late-refund-attempt`,
      expectedAmountCents: 9_000,
      currency: "NZD",
      country: "NZ",
      status: "paid",
      websiteAnalyticsPaidAt: paidAt,
      websiteAnalyticsRefundedAt: refundedAt,
    });
    await repository.recordFinancialEvent({
      orderId,
      eventType: "receipt",
      sourceType: "payment_attempt",
      sourceId: attemptId,
      amountCents: 9_000,
      currency: "NZD",
      occurredAt: paidAt,
      historical: false,
    });

    const result = await createWebsiteAnalyticsV2Reconciliation(database).run({
      now: new Date("2298-10-10T02:00:00.000Z"),
      recentDays: 3,
      repairBatchSize: 10,
      maxDirtyDates: 3,
      sources: ["direct_payment_refund_transitions"],
      stateKeyPrefix: `${prefix}late-refund-repair`,
    });

    expect(result.repair.totals).toMatchObject({
      scanned: 1,
      created: 1,
      unchanged: 0,
      skipped: 0,
      failed: 0,
    });
    expect(await database.select({
      eventType: websiteAnalyticsFinancialEvents.eventType,
      occurredAt: websiteAnalyticsFinancialEvents.occurredAt,
    }).from(websiteAnalyticsFinancialEvents).where(and(
      eq(websiteAnalyticsFinancialEvents.sourceType, "payment_attempt"),
      eq(websiteAnalyticsFinancialEvents.sourceId, attemptId),
    ))).toEqual(expect.arrayContaining([
      { eventType: "receipt", occurredAt: paidAt },
      { eventType: "refund", occurredAt: refundedAt },
    ]));
  });

  it("handles empty data and a single exact inquiry without copying message content", async () => {
    const empty = await createWebsiteAnalyticsV2Backfill(database).run({
      dryRun: false,
      batchSize: 5,
      sources: ["website_inquiries"],
      stateKeyPrefix: `${prefix}empty`,
      fromOccurredAt: new Date("2300-01-01T00:00:00.000Z"),
    });
    expect(empty.totals).toEqual({
      scanned: 0,
      created: 0,
      wouldCreate: 0,
      unchanged: 0,
      skipped: 0,
      failed: 0,
    });
    const conversationId = await websiteInquiry(new Date("2298-07-01T00:00:00.000Z"));
    sourceIds.push(conversationId);
    const one = await createWebsiteAnalyticsV2Backfill(database).run({
      dryRun: false,
      batchSize: 5,
      sources: ["website_inquiries"],
      stateKeyPrefix: `${prefix}inquiry`,
      fromOccurredAt: new Date("2298-07-01T00:00:00.000Z"),
    });
    expect(one.totals).toMatchObject({ scanned: 1, created: 1, failed: 0 });
    expect(JSON.stringify(await database.select().from(websiteAnalyticsConversions)
      .where(eq(websiteAnalyticsConversions.sourceId, conversationId))))
      .not.toContain("Task 5 test inquiry");
  });

  it("repairs exact manual creation and payment audits after mutable job edits", async () => {
    const legacyJobId = await manualOrder(new Date("2298-08-01T00:00:00.000Z"));
    const jobId = await manualOrder(new Date("2298-08-02T00:00:00.000Z"));
    sourceIds.push(legacyJobId, jobId);
    const createAuditId = randomUUID();
    const updateAuditId = randomUUID();
    const updateIdempotencyKey = `${prefix}manual-payment-update`;
    await database.insert(adminAuditLogs).values([
      {
        id: createAuditId,
        actorUserId: "task-5-fixture",
        actorEmail: "task-5-fixture@example.test",
        action: "production_job.created",
        resourceType: "production_job",
        resourceId: jobId,
        afterSummary: {
          source: "manual",
          websiteAnalyticsV2: {
            version: 1,
            event: "manual_order_created",
            occurredAt: "2298-08-02T00:00:00.000Z",
            amountPayableCents: 15_000,
            amountPaidBeforeCents: 0,
            amountPaidAfterCents: 3_000,
            initialStatus: "new",
            currency: "NZD",
          },
        },
        requestSource: "admin.jobs.manual",
        result: "success",
        idempotencyKey: `${prefix}manual-create-audit`,
        createdAt: new Date("2298-08-02T00:00:01.000Z"),
      },
      {
        id: updateAuditId,
        actorUserId: "task-5-fixture",
        actorEmail: "task-5-fixture@example.test",
        action: "production_job.updated",
        resourceType: "production_job",
        resourceId: jobId,
        afterSummary: {
          websiteAnalyticsV2: {
            version: 1,
            event: "manual_payment_increased",
            occurredAt: "2298-08-03T00:00:00.000Z",
            amountPaidBeforeCents: 3_000,
            amountPaidAfterCents: 8_000,
            deltaCents: 5_000,
            currency: "NZD",
          },
        },
        requestSource: "admin.jobs.detail",
        result: "success",
        idempotencyKey: updateIdempotencyKey,
        createdAt: new Date("2298-08-03T00:00:01.000Z"),
      },
    ]);
    await database.update(productionJobs).set({
      manualStatus: "cancelled",
      manualPaymentStatus: "paid",
      amountPayableCents: 99_000,
      amountPaidCents: 99_000,
      updatedAt: new Date("2298-08-04T00:00:00.000Z"),
    }).where(eq(productionJobs.id, jobId));

    const backfill = createWebsiteAnalyticsV2Backfill(database);
    const sources = ["manual_orders", "manual_payment_updates"] as const;
    const stateKeyPrefix = `${prefix}manual`;
    const preview = await backfill.run({
      dryRun: true,
      batchSize: 10,
      sources,
      stateKeyPrefix,
      fromOccurredAt: new Date("2298-08-01T00:00:00.000Z"),
    });
    expect(preview.totals).toMatchObject({
      scanned: 3,
      wouldCreate: 3,
      unchanged: 0,
      skipped: 1,
      failed: 0,
    });
    expect(await database.select().from(websiteAnalyticsConversions)
      .where(inArray(websiteAnalyticsConversions.sourceId, [legacyJobId, jobId]))).toEqual([]);
    expect(await database.select().from(websiteAnalyticsReconciliationState)
      .where(sql`${websiteAnalyticsReconciliationState.stateKey} like ${`${stateKeyPrefix}%`}`))
      .toEqual([]);

    const result = await backfill.run({
      dryRun: false,
      batchSize: 10,
      sources,
      stateKeyPrefix,
      fromOccurredAt: new Date("2298-08-01T00:00:00.000Z"),
    });
    expect(result.totals).toMatchObject({ scanned: 3, created: 3, skipped: 1, failed: 0 });
    expect(result.sources.map((sourceResult) => ({
      source: sourceResult.source,
      scanned: sourceResult.scanned,
      created: sourceResult.created,
      skipped: sourceResult.skipped,
      cursor: sourceResult.cursor,
    }))).toEqual(preview.sources.map((sourceResult) => ({
      source: sourceResult.source,
      scanned: sourceResult.scanned,
      created: sourceResult.wouldCreate,
      skipped: sourceResult.skipped,
      cursor: sourceResult.cursor,
    })));
    expect(await database.select({
      sourceId: websiteAnalyticsConversions.sourceId,
      scope: websiteAnalyticsConversions.scope,
      currency: websiteAnalyticsConversions.currency,
      amount: websiteAnalyticsConversions.orderedAmountInclGstCents,
      historical: websiteAnalyticsConversions.historical,
    }).from(websiteAnalyticsConversions)
      .where(eq(websiteAnalyticsConversions.sourceId, jobId))).toEqual([{
      sourceId: jobId,
      scope: "all_business",
      currency: "NZD",
      amount: 15_000,
      historical: true,
    }]);
    expect(await database.select({
      sourceId: websiteAnalyticsFinancialEvents.sourceId,
      amountCents: websiteAnalyticsFinancialEvents.amountCents,
      currency: websiteAnalyticsFinancialEvents.currency,
      occurredAt: websiteAnalyticsFinancialEvents.occurredAt,
    }).from(websiteAnalyticsFinancialEvents)
      .where(eq(websiteAnalyticsFinancialEvents.productionJobId, jobId)))
      .toEqual(expect.arrayContaining([
        {
          sourceId: `manual-create:${jobId}`,
          amountCents: 3_000,
          currency: "NZD",
          occurredAt: new Date("2298-08-02T00:00:00.000Z"),
        },
        {
          sourceId: `manual-update:${jobId}:${updateIdempotencyKey}`,
          amountCents: 5_000,
          currency: "NZD",
          occurredAt: new Date("2298-08-03T00:00:00.000Z"),
        },
      ]));
    expect(await database.select().from(websiteAnalyticsConversions)
      .where(eq(websiteAnalyticsConversions.sourceId, legacyJobId))).toEqual([]);
    expect(result.limitations).toEqual(expect.arrayContaining([
      expect.stringMatching(/manual.*audit.*skipped/i),
    ]));
  });
});
