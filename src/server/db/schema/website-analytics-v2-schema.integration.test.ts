import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { assertIsolatedTestDatabaseUrl } from "../../../../scripts/migration-safety";
import {
  checkoutSessions,
  orders,
  productionJobs,
  websiteAnalyticsAttributionSnapshots,
  websiteAnalyticsConversions,
  websiteAnalyticsFinancialEvents,
  websiteAnalyticsPageviews,
  websiteAnalyticsSessions,
} from "./index";
import { createWebsiteAnalyticsRetentionRepository } from "../../analytics/website-analytics-retention-repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");
assertIsolatedTestDatabaseUrl(testDatabaseUrl, process.env);

const pool = new Pool({ connectionString: testDatabaseUrl });
const database = drizzle(pool);

afterAll(async () => {
  await pool.end();
});

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

describe("Website Analytics V2 database behavior", () => {
  it("keeps direct payment transition evidence nullable and default-free", async () => {
    const result = await pool.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(`
      select column_name, data_type, is_nullable, column_default
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'payment_attempts'
        and column_name in (
          'website_analytics_paid_at',
          'website_analytics_refunded_at'
        )
      order by column_name
    `);

    expect(result.rows).toEqual([
      {
        column_name: "website_analytics_paid_at",
        data_type: "timestamp with time zone",
        is_nullable: "YES",
        column_default: null,
      },
      {
        column_name: "website_analytics_refunded_at",
        data_type: "timestamp with time zone",
        is_nullable: "YES",
        column_default: null,
      },
    ]);
  });

  it("retains conversion and attribution facts after V1 session retention", async () => {
    const sessionId = randomUUID();
    const conversionId = randomUUID();
    const snapshotIds = [randomUUID(), randomUUID()];
    const occurredAt = new Date("2000-01-01T00:00:00.000Z");
    const cutoff = new Date("2000-04-01T00:00:00.000Z");
    const visitorDigest = digest(sessionId);

    try {
      await database.insert(websiteAnalyticsSessions).values({
        id: sessionId,
        visitorDigest,
        startedAt: occurredAt,
        localDate: "2000-01-01",
        channel: "direct",
        source: "direct",
      });
      await database.insert(websiteAnalyticsPageviews).values({
        id: randomUUID(),
        sessionId,
        occurredAt,
        localDate: "2000-01-01",
        pathname: "/shop",
      });
      await database.insert(websiteAnalyticsConversions).values({
        id: conversionId,
        conversionType: "inquiry",
        sourceType: "customer_service_conversation",
        sourceId: `retention:${randomUUID()}`,
        occurredAt,
        localDate: "2000-01-01",
        scope: "website",
        visitorDigest,
        convertingSessionId: sessionId,
        firstSessionId: sessionId,
        lastSessionId: sessionId,
        lastNonDirectSessionId: sessionId,
        consentLinked: true,
      });
      await database.insert(websiteAnalyticsAttributionSnapshots).values([
        {
          id: snapshotIds[0],
          conversionId,
          sessionId,
          attributionModel: "first_touch",
          channel: "direct",
          source: "direct",
          visitorReference: visitorDigest,
          conversionReference: `retention:${conversionId}`,
          attributedAt: occurredAt,
        },
        {
          id: snapshotIds[1],
          conversionId,
          sessionId,
          attributionModel: "last_touch",
          channel: "direct",
          source: "direct",
          visitorReference: visitorDigest,
          conversionReference: `retention:${conversionId}`,
          attributedAt: occurredAt,
        },
      ]);

      await expect(createWebsiteAnalyticsRetentionRepository(database)
        .deleteBefore({ cutoff, limit: 500 })).resolves.toBe(1);

      expect(await database.select({ id: websiteAnalyticsSessions.id })
        .from(websiteAnalyticsSessions)
        .where(eq(websiteAnalyticsSessions.id, sessionId))).toEqual([]);
      expect(await database.select({ id: websiteAnalyticsPageviews.id })
        .from(websiteAnalyticsPageviews)
        .where(eq(websiteAnalyticsPageviews.sessionId, sessionId))).toEqual([]);
      expect(await database.select({
        id: websiteAnalyticsConversions.id,
        convertingSessionId: websiteAnalyticsConversions.convertingSessionId,
        firstSessionId: websiteAnalyticsConversions.firstSessionId,
        lastSessionId: websiteAnalyticsConversions.lastSessionId,
        lastNonDirectSessionId: websiteAnalyticsConversions.lastNonDirectSessionId,
      }).from(websiteAnalyticsConversions)
        .where(eq(websiteAnalyticsConversions.id, conversionId))).toEqual([{
        id: conversionId,
        convertingSessionId: null,
        firstSessionId: null,
        lastSessionId: null,
        lastNonDirectSessionId: null,
      }]);
      expect(await database.select({ sessionId: websiteAnalyticsAttributionSnapshots.sessionId })
        .from(websiteAnalyticsAttributionSnapshots)
        .where(eq(websiteAnalyticsAttributionSnapshots.conversionId, conversionId)))
        .toEqual([{ sessionId: null }, { sessionId: null }]);
    } finally {
      await database.delete(websiteAnalyticsConversions)
        .where(eq(websiteAnalyticsConversions.id, conversionId));
      await database.delete(websiteAnalyticsSessions)
        .where(eq(websiteAnalyticsSessions.id, sessionId));
    }
  });

  it.each([
    { label: "null market", market: null, currency: "NZD", amount: 10_000 },
    { label: "null currency", market: "NZ", currency: null, amount: 10_000 },
    { label: "null amount", market: "NZ", currency: "NZD", amount: null },
    { label: "NZ/AUD mismatch", market: "NZ", currency: "AUD", amount: 10_000 },
    { label: "AU/NZD mismatch", market: "AU", currency: "NZD", amount: 10_000 },
    { label: "zero amount", market: "NZ", currency: "NZD", amount: 0 },
    { label: "negative amount", market: "NZ", currency: "NZD", amount: -1 },
  ])("rejects an order conversion with $label", async ({ market, currency, amount }) => {
    const client = await pool.connect();
    let failure: unknown;
    try {
      await client.query("begin");
      try {
        await client.query(`
          insert into website_analytics_conversions (
            id, conversion_type, source_type, source_id, occurred_at, local_date,
            scope, market, currency, ordered_amount_incl_gst_cents
          ) values ($1, 'order', 'order', $2, $3, '2026-08-30', 'website', $4, $5, $6)
        `, [randomUUID(), randomUUID(), new Date("2026-08-30T00:00:00.000Z"), market, currency, amount]);
      } catch (error) {
        failure = error;
      }
      expect(failure).toMatchObject({
        constraint: "website_analytics_conversions_commercial_shape_valid",
      });
    } finally {
      await client.query("rollback");
      client.release();
    }
  });

  it.each([
    { market: "NZ", currency: "NZD" },
    { market: "AU", currency: "AUD" },
  ])("accepts a valid $market/$currency order conversion", async ({ market, currency }) => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const result = await client.query(`
        insert into website_analytics_conversions (
          id, conversion_type, source_type, source_id, occurred_at, local_date,
          scope, market, currency, ordered_amount_incl_gst_cents
        ) values ($1, 'order', 'order', $2, $3, '2026-08-30', 'website', $4, $5, 10000)
        returning market, currency, ordered_amount_incl_gst_cents
      `, [randomUUID(), randomUUID(), new Date("2026-08-30T00:00:00.000Z"), market, currency]);
      expect(result.rows).toEqual([{
        market,
        currency,
        ordered_amount_incl_gst_cents: "10000",
      }]);
    } finally {
      await client.query("rollback");
      client.release();
    }
  });

  it("preserves a financial fact after its conversion parent is deleted", async () => {
    const conversionId = randomUUID();
    const financialId = randomUUID();
    const sourceId = `provider:${randomUUID()}`;
    try {
      await database.insert(websiteAnalyticsConversions).values({
        id: conversionId,
        conversionType: "inquiry",
        sourceType: "customer_service_conversation",
        sourceId: `conversation:${randomUUID()}`,
        occurredAt: new Date("2026-08-30T00:00:00.000Z"),
        localDate: "2026-08-30",
        scope: "website",
      });
      await database.insert(websiteAnalyticsFinancialEvents).values({
        id: financialId,
        conversionId,
        eventType: "receipt",
        sourceType: "payment_provider_event",
        sourceId,
        amountCents: 10_000,
        currency: "NZD",
        occurredAt: new Date("2026-08-30T00:00:00.000Z"),
        localDate: "2026-08-30",
      });

      await database.delete(websiteAnalyticsConversions)
        .where(eq(websiteAnalyticsConversions.id, conversionId));

      expect(await database.select({
        conversionId: websiteAnalyticsFinancialEvents.conversionId,
        sourceType: websiteAnalyticsFinancialEvents.sourceType,
        sourceId: websiteAnalyticsFinancialEvents.sourceId,
      }).from(websiteAnalyticsFinancialEvents)
        .where(eq(websiteAnalyticsFinancialEvents.id, financialId))).toEqual([{
        conversionId: null,
        sourceType: "payment_provider_event",
        sourceId,
      }]);
    } finally {
      await database.delete(websiteAnalyticsFinancialEvents)
        .where(eq(websiteAnalyticsFinancialEvents.id, financialId));
      await database.delete(websiteAnalyticsConversions)
        .where(eq(websiteAnalyticsConversions.id, conversionId));
    }
  });

  it("preserves a financial fact after its order parent is deleted", async () => {
    const financialId = randomUUID();
    const sessionId = randomUUID();
    let orderId: string | undefined;
    const sourceId = `attempt:${randomUUID()}`;
    try {
      await database.insert(checkoutSessions).values({
        id: sessionId,
        tokenDigest: `analytics-v2:${randomUUID()}`,
        expiresAt: new Date("2027-08-30T00:00:00.000Z"),
        completedAt: new Date("2026-08-30T00:00:00.000Z"),
      });
      const [order] = await database.insert(orders).values({
        orderNumber: `RNR-A2-${randomUUID().slice(0, 8)}`,
        checkoutSessionId: sessionId,
        checkoutSessionVersion: 1,
        idempotencyKey: randomUUID(),
        customerEmail: "analytics-v2@example.test",
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
          productSubtotalExTaxCents: 10_000,
          productTaxCents: 0,
          productTotalInclTaxCents: 10_000,
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
          finalTotalCents: 10_000,
        },
        deliveryMethod: "pickup",
        shippingServiceCode: "pickup",
        shippingServiceName: "Pickup",
        productSubtotalExGstCents: 10_000,
        productGstCents: 0,
        productTotalInclGstCents: 10_000,
        shippingExGstCents: 0,
        shippingGstCents: 0,
        shippingTotalInclGstCents: 0,
        totalExGstCents: 10_000,
        totalGstCents: 0,
        totalInclGstCents: 10_000,
      }).returning({ id: orders.id });
      orderId = order.id;
      await database.insert(websiteAnalyticsFinancialEvents).values({
        id: financialId,
        orderId,
        eventType: "receipt",
        sourceType: "payment_attempt",
        sourceId,
        amountCents: 10_000,
        currency: "NZD",
        occurredAt: new Date("2026-08-30T00:00:00.000Z"),
        localDate: "2026-08-30",
      });

      await database.delete(orders).where(eq(orders.id, orderId));

      expect(await database.select({
        orderId: websiteAnalyticsFinancialEvents.orderId,
        sourceType: websiteAnalyticsFinancialEvents.sourceType,
        sourceId: websiteAnalyticsFinancialEvents.sourceId,
      }).from(websiteAnalyticsFinancialEvents)
        .where(eq(websiteAnalyticsFinancialEvents.id, financialId))).toEqual([{
        orderId: null,
        sourceType: "payment_attempt",
        sourceId,
      }]);
    } finally {
      await database.delete(websiteAnalyticsFinancialEvents)
        .where(eq(websiteAnalyticsFinancialEvents.id, financialId));
      if (orderId) await database.delete(orders).where(eq(orders.id, orderId));
      await database.delete(checkoutSessions).where(eq(checkoutSessions.id, sessionId));
    }
  });

  it("preserves a financial fact after its production-job parent is deleted", async () => {
    const jobId = randomUUID();
    const financialId = randomUUID();
    const sourceId = `manual-update:${randomUUID()}`;
    try {
      await database.insert(productionJobs).values({
        id: jobId,
        jobNumber: `A2-${randomUUID().slice(0, 8)}`,
        source: "manual",
        idempotencyKey: randomUUID(),
        requestDigest: digest(randomUUID()),
        customerName: "Analytics Test",
        customerEmail: "analytics-v2@example.test",
        customerPhone: "",
        customerSource: "web",
        manualStatus: "new",
        manualPaymentStatus: "awaiting_payment",
        neededDate: "2026-09-01",
        deliveryMethod: "pickup",
        amountPayableCents: 10_000,
        amountPaidCents: 0,
        artistFeeCents: 0,
        materialCostCents: 0,
      });
      await database.insert(websiteAnalyticsFinancialEvents).values({
        id: financialId,
        productionJobId: jobId,
        eventType: "receipt",
        sourceType: "manual_payment_update",
        sourceId,
        amountCents: 1_000,
        currency: "NZD",
        occurredAt: new Date("2026-08-30T00:00:00.000Z"),
        localDate: "2026-08-30",
      });

      await database.delete(productionJobs).where(eq(productionJobs.id, jobId));

      expect(await database.select({
        productionJobId: websiteAnalyticsFinancialEvents.productionJobId,
        sourceType: websiteAnalyticsFinancialEvents.sourceType,
        sourceId: websiteAnalyticsFinancialEvents.sourceId,
      }).from(websiteAnalyticsFinancialEvents)
        .where(eq(websiteAnalyticsFinancialEvents.id, financialId))).toEqual([{
        productionJobId: null,
        sourceType: "manual_payment_update",
        sourceId,
      }]);
    } finally {
      await database.delete(websiteAnalyticsFinancialEvents)
        .where(eq(websiteAnalyticsFinancialEvents.id, financialId));
      await database.delete(productionJobs).where(eq(productionJobs.id, jobId));
    }
  });

  it("uses the visitor-first index for a representative 90-day attribution lookup", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(`
        insert into website_analytics_sessions (
          id, visitor_digest, started_at, local_date, channel, source
        )
        select gen_random_uuid(),
          md5((i % 5000)::text) || md5((i % 5000)::text),
          timestamptz '2026-02-01 00:00:00+00'
            + (i % 180) * interval '1 day'
            + (i % 86400) * interval '1 second',
          date '2026-02-01' + (i % 180),
          'direct', 'direct'
        from generate_series(1, 50000) i
      `);
      await client.query("analyze website_analytics_sessions");
      const target = createHash("md5").update("42").digest("hex").repeat(2);
      const result = await client.query(`
        explain (analyze, buffers, costs off, format json)
        select id, started_at
        from website_analytics_sessions
        where visitor_digest = $1
          and started_at >= timestamptz '2026-04-30 00:00:00+00'
          and started_at <= timestamptz '2026-07-29 00:00:00+00'
        order by started_at, id
      `, [target]);
      const plan = JSON.stringify(result.rows[0]["QUERY PLAN"]);
      expect(plan).toContain("website_analytics_sessions_visitor_started_id_idx");
      expect(plan).not.toContain('"Node Type":"Seq Scan"');
    } finally {
      await client.query("rollback");
      client.release();
    }
  });
});
