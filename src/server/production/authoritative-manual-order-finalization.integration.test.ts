import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  adminAuditLogs,
  analyticsConversionDeliveries,
  invoices,
  productionFieldValues,
  productionJobs,
  user,
  websiteAnalyticsConversions,
  websiteAnalyticsFinancialEvents,
} from "@/server/db/schema";
import { createWebsiteAnalyticsV2BusinessRecorder } from "@/server/analytics/website-analytics-v2-business-recorder";
import { assertIsolatedTestDatabaseUrl } from "../../../scripts/migration-safety";
import {
  createDrizzleProductionJobRepository,
  recordManualConversionEvidence,
} from "./drizzle-production-job-repository";
import { createProductionJobService } from "./production-job-service";

const databaseUrl = assertIsolatedTestDatabaseUrl(
  process.env.TEST_DATABASE_URL,
  process.env,
).url;
const pool = new Pool({ connectionString: databaseUrl, max: 10 });
const database = drizzle(pool);
const suffix = randomUUID();
const actorId = `manual-finalization-actor-${suffix}`;
const jobIds: string[] = [];
const finalizedAt = new Date("2026-08-20T01:00:00.000Z");
const policy = Object.freeze({
  google: Object.freeze({ enabled: true, activatedAt: new Date("2026-08-01T00:00:00.000Z") }),
  meta: Object.freeze({ enabled: true, activatedAt: new Date("2026-08-01T00:00:00.000Z") }),
});
const analyticsRecorder = createWebsiteAnalyticsV2BusinessRecorder(database, {
  config: {
    enabled: false,
    cookieSecret: null,
    v2Enabled: true,
    attributionLookbackDays: 90,
  },
});

function manualInput(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: `manual-finalization-${randomUUID()}`,
    customerName: "Synthetic Customer",
    customerEmail: "synthetic@example.test",
    customerPhone: "+64 21 000 0000",
    customerSource: "messenger",
    webOrderNumber: "",
    urgent: false,
    neededDate: "2026-09-01",
    deliveryMethod: "post",
    deliveryAddress: "Synthetic address",
    paymentReconciliationStatus: "Not checked",
    assignedUserId: null,
    designRequirements: "Synthetic requirement",
    internalNotes: "",
    manualStatus: "new",
    manualPaymentStatus: "awaiting_payment",
    amountPayableCents: 20_000,
    amountPaidCents: 0,
    artistFeeCents: 0,
    materialCostCents: 0,
    conversionEvidence: {
      consentDecision: "granted",
      consentRecordedAt: "2026-08-20T00:30:00.000Z",
      source: "meta",
      attribution: { fbp: "fb.1.1720000000000.123456789" },
    },
    customFields: [],
    items: [{
      productTitle: "Synthetic Canvas",
      sizeLabel: "A3",
      quantity: 1,
      designText: "",
      notes: "",
    }],
    ...overrides,
  };
}

function service(options: Parameters<typeof createDrizzleProductionJobRepository>[1] = {}) {
  return createProductionJobService(
    createDrizzleProductionJobRepository(database, {
      conversionPolicy: policy,
      analyticsRecorder,
      ...options,
    }),
    {
      createJobNumber: () => `MANUAL-${randomUUID()}`,
      now: () => finalizedAt,
    },
  );
}

async function create(overrides: Record<string, unknown> = {}) {
  const result = await service().createManual({
    userId: actorId,
    email: `manual-finalization-${suffix}@example.test`,
  }, manualInput(overrides), { canUpdateFinance: true });
  jobIds.push(result.job.id);
  return result.job;
}

describe("authoritative manual order finalization", () => {
  beforeAll(async () => {
    await database.insert(user).values({
      id: actorId,
      name: "Manual Finalization Test Actor",
      email: `manual-finalization-${suffix}@example.test`,
      role: "admin",
    });
  });

  afterAll(async () => {
    if (jobIds.length) {
      await database.delete(websiteAnalyticsFinancialEvents)
        .where(inArray(websiteAnalyticsFinancialEvents.productionJobId, jobIds));
      await database.delete(websiteAnalyticsConversions)
        .where(inArray(websiteAnalyticsConversions.productionJobId, jobIds));
      await database.delete(analyticsConversionDeliveries)
        .where(inArray(analyticsConversionDeliveries.jobId, jobIds));
      await database.delete(adminAuditLogs).where(and(
        eq(adminAuditLogs.resourceType, "production_job"),
        inArray(adminAuditLogs.resourceId, jobIds),
      ));
      await database.delete(invoices).where(inArray(invoices.jobId, jobIds));
      await database.delete(productionJobs).where(inArray(productionJobs.id, jobIds));
    }
    await database.delete(user).where(eq(user.id, actorId));
    await pool.end();
  });

  it("creates one immutable manual order fact and one exact initial receipt only at createManual", async () => {
    const job = await create({
      manualPaymentStatus: "processing",
      amountPaidCents: 4_500,
    });

    expect(await database.select().from(websiteAnalyticsConversions)
      .where(eq(websiteAnalyticsConversions.productionJobId, job.id)))
      .toEqual([expect.objectContaining({
        conversionType: "order",
        sourceType: "production_job",
        sourceId: job.id,
        orderedAmountInclGstCents: 20_000,
        occurredAt: finalizedAt,
      })]);
    expect(await database.select().from(websiteAnalyticsFinancialEvents)
      .where(eq(websiteAnalyticsFinancialEvents.productionJobId, job.id)))
      .toEqual([expect.objectContaining({
        eventType: "receipt",
        sourceType: "manual_payment_update",
        sourceId: `manual-create:${job.id}`,
        amountCents: 4_500,
        occurredAt: finalizedAt,
      })]);
  });

  it("does not create a manual order fact for cancelled or zero-value finalisation", async () => {
    const cancelled = await create({ manualStatus: "cancelled" });
    const zero = await create({ amountPayableCents: 0 });
    expect(await database.select().from(websiteAnalyticsConversions)
      .where(inArray(websiteAnalyticsConversions.productionJobId, [cancelled.id, zero.id])))
      .toEqual([]);
  });

  it.each(["awaiting_payment", "processing", "paid"] as const)(
    "creates one Purchase delivery when an order is finalized with %s payment status",
    async (manualPaymentStatus) => {
      const job = await create({
        manualPaymentStatus,
        amountPaidCents: manualPaymentStatus === "paid" ? 20_000 : 0,
      });
      const rows = await database.select().from(analyticsConversionDeliveries)
        .where(eq(analyticsConversionDeliveries.jobId, job.id));
      expect(rows).toEqual([expect.objectContaining({
        platform: "meta",
        transactionId: `manual-order:${job.id}`,
        eventOccurredAt: finalizedAt,
        currency: "NZD",
        valueMinor: 20_000,
        status: "pending",
      })]);
    },
  );

  it("creates one Google and one Meta row when both platforms are independently eligible", async () => {
    const job = await create({
      customerSource: "messenger",
      conversionEvidence: {
        consentDecision: "granted",
        consentRecordedAt: "2026-08-20T00:30:00.000Z",
        source: "google",
        attribution: { gclid: "synthetic-google-click" },
      },
    });
    const rows = await database.select().from(analyticsConversionDeliveries)
      .where(eq(analyticsConversionDeliveries.jobId, job.id));
    expect(rows.map((row) => row.platform).sort()).toEqual(["google", "meta"]);
    expect(rows.every((row) => row.transactionId === `manual-order:${job.id}`)).toBe(true);
  });

  it("does not create a delivery without granted consent evidence", async () => {
    const job = await create({ conversionEvidence: undefined });
    expect(await database.select().from(analyticsConversionDeliveries)
      .where(eq(analyticsConversionDeliveries.jobId, job.id))).toEqual([]);
  });

  it("rolls back the complete order when eligible outbox persistence fails", async () => {
    const idempotencyKey = `manual-finalization-rollback-${suffix}`;
    await expect(service({
      enqueueDeliveries: async () => {
        throw new Error("synthetic finalization outbox failure");
      },
    }).createManual({
      userId: actorId,
      email: `manual-finalization-${suffix}@example.test`,
    }, manualInput({ idempotencyKey }), { canUpdateFinance: true }))
      .rejects.toThrow("synthetic finalization outbox failure");
    expect(await database.select().from(productionJobs)
      .where(eq(productionJobs.idempotencyKey, idempotencyKey))).toEqual([]);
  });

  it("keeps committed manual creation and payment updates successful when analytics fails", async () => {
    const failingAnalytics = {
      recordManualOrder: vi.fn().mockRejectedValue(new Error("analytics unavailable")),
      recordManualPaymentUpdate: vi.fn().mockRejectedValue(new Error("analytics unavailable")),
    };
    const runtime = service({ analyticsRecorder: failingAnalytics });
    const created = await runtime.createManual({
      userId: actorId,
      email: `manual-finalization-${suffix}@example.test`,
    }, manualInput({ conversionEvidence: undefined }), { canUpdateFinance: true });
    jobIds.push(created.job.id);
    expect(failingAnalytics.recordManualOrder).toHaveBeenCalledOnce();

    const repository = createDrizzleProductionJobRepository(database, {
      conversionPolicy: policy,
      analyticsRecorder: failingAnalytics,
    });
    await expect(repository.update({
      jobId: created.job.id,
      idempotencyKey: `analytics-failure-update-${created.job.id}`,
      expectedUpdatedAt: created.job.updatedAt,
      actor: { userId: actorId, email: `manual-finalization-${suffix}@example.test` },
      updatedAt: new Date("2026-08-20T03:30:00.000Z"),
      canUpdateFinance: true,
      finance: {
        manualPaymentStatus: "processing",
        amountPayableCents: 20_000,
        amountPaidCents: 5_000,
        artistFeeCents: 0,
        materialCostCents: 0,
      },
    })).resolves.toBe("updated");
    expect(failingAnalytics.recordManualPaymentUpdate).toHaveBeenCalledOnce();
  });

  it("never creates another Purchase when payment, amount or customer data changes", async () => {
    const job = await create();
    const repository = createDrizzleProductionJobRepository(database, {
      conversionPolicy: policy,
      analyticsRecorder,
    });
    expect(await repository.update({
      jobId: job.id,
      idempotencyKey: `later-edit-${job.id}`,
      expectedUpdatedAt: job.updatedAt,
      actor: { userId: actorId, email: `manual-finalization-${suffix}@example.test` },
      updatedAt: new Date("2026-08-20T03:00:00.000Z"),
      canUpdateFinance: true,
      customerEmail: "changed@example.test",
      internalNotes: "Changed later",
      finance: {
        manualPaymentStatus: "paid",
        amountPayableCents: 25_000,
        amountPaidCents: 25_000,
        artistFeeCents: 0,
        materialCostCents: 0,
      },
    })).toBe("updated");
    const rows = await database.select().from(analyticsConversionDeliveries)
      .where(eq(analyticsConversionDeliveries.jobId, job.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      eventOccurredAt: finalizedAt,
      valueMinor: 20_000,
    });
    expect(await database.select().from(websiteAnalyticsConversions)
      .where(eq(websiteAnalyticsConversions.productionJobId, job.id))).toHaveLength(1);
    expect(await database.select().from(websiteAnalyticsFinancialEvents)
      .where(eq(websiteAnalyticsFinancialEvents.productionJobId, job.id)))
      .toEqual([expect.objectContaining({
        eventType: "receipt",
        amountCents: 25_000,
        occurredAt: new Date("2026-08-20T03:00:00.000Z"),
      })]);
    const [paid] = await database.select().from(productionJobs)
      .where(eq(productionJobs.id, job.id));
    expect(paid.manualPaymentConfirmedAt).toBeInstanceOf(Date);

    expect(await repository.update({
      jobId: job.id,
      idempotencyKey: `payment-reversal-${job.id}`,
      expectedUpdatedAt: paid.updatedAt,
      actor: { userId: actorId, email: `manual-finalization-${suffix}@example.test` },
      updatedAt: new Date("2026-08-20T04:00:00.000Z"),
      canUpdateFinance: true,
      finance: {
        manualPaymentStatus: "processing",
        amountPayableCents: 25_000,
        amountPaidCents: 0,
        artistFeeCents: 0,
        materialCostCents: 0,
      },
    })).toBe("updated");
    const [reversed] = await database.select().from(productionJobs)
      .where(eq(productionJobs.id, job.id));
    expect(reversed.manualPaymentConfirmedAt).toEqual(paid.manualPaymentConfirmedAt);
    expect(await database.select().from(analyticsConversionDeliveries)
      .where(eq(analyticsConversionDeliveries.jobId, job.id))).toHaveLength(1);
    expect(await database.select().from(websiteAnalyticsFinancialEvents)
      .where(eq(websiteAnalyticsFinancialEvents.productionJobId, job.id))).toHaveLength(1);
  });

  it("rejects attribution evidence added after the order was finalized", async () => {
    const job = await create({ conversionEvidence: undefined });
    expect(await recordManualConversionEvidence(database, {
      jobId: job.id,
      actor: { userId: actorId, email: `manual-finalization-${suffix}@example.test` },
      consentDecision: "granted",
      consentRecordedAt: new Date("2026-08-20T02:00:00.000Z"),
      source: "meta",
      attribution: { fbp: "fb.1.1720000000000.987654321" },
    })).toBe("already_finalized");
    expect(await database.select().from(productionFieldValues)
      .where(eq(productionFieldValues.jobId, job.id))).toEqual([]);
    expect(await database.select().from(analyticsConversionDeliveries)
      .where(eq(analyticsConversionDeliveries.jobId, job.id))).toEqual([]);
  });

  it("creates at most one platform delivery when duplicate finalization requests race", async () => {
    const idempotencyKey = `manual-finalization-race-${suffix}`;
    const runtime = service();
    const actor = {
      userId: actorId,
      email: `manual-finalization-${suffix}@example.test`,
    };
    const results = await Promise.allSettled([
      runtime.createManual(actor, manualInput({ idempotencyKey }), { canUpdateFinance: true }),
      runtime.createManual(actor, manualInput({ idempotencyKey }), { canUpdateFinance: true }),
    ]);
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    const rows = await database.select({ id: productionJobs.id }).from(productionJobs)
      .where(eq(productionJobs.idempotencyKey, idempotencyKey));
    expect(rows).toHaveLength(1);
    jobIds.push(rows[0].id);
    expect(await database.select().from(analyticsConversionDeliveries)
      .where(eq(analyticsConversionDeliveries.jobId, rows[0].id))).toHaveLength(1);
  });

  it("does not create executable history before platform activation", async () => {
    const historicalService = createProductionJobService(
      createDrizzleProductionJobRepository(database, { conversionPolicy: policy }),
      { createJobNumber: () => `MANUAL-${randomUUID()}`, now: () => new Date("2026-07-31T23:59:59.000Z") },
    );
    const result = await historicalService.createManual({
      userId: actorId,
      email: `manual-finalization-${suffix}@example.test`,
    }, manualInput(), { canUpdateFinance: true });
    jobIds.push(result.job.id);
    expect(await database.select().from(analyticsConversionDeliveries)
      .where(eq(analyticsConversionDeliveries.jobId, result.job.id))).toEqual([]);
  });
});
