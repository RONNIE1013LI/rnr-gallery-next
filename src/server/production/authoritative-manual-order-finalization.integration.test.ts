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

function invoiceDraft() {
  return {
    invoiceDate: "2026-08-20",
    dueDate: "2026-08-27",
    reference: "DRAFT",
    businessName: "R&R Gallery",
    businessAddress: "Synthetic business address",
    businessEmail: "synthetic-business@example.test",
    businessPhone: "+64 21 000 0001",
    businessWebsite: "https://example.test",
    gstNumber: "000-000-000",
    bankAccount: "00-0000-0000000-00",
    customerName: "Synthetic Customer",
    customerEmail: "synthetic@example.test",
    customerAddress: "Synthetic customer address",
    deliveryAddress: "Synthetic delivery address",
    discountCents: 0,
    notes: "Synthetic invoice",
    terms: "Seven days",
    items: [{
      code: "SYN",
      description: "Synthetic Canvas",
      quantityMilli: 1_000,
      rateInclGstCents: 20_000,
    }],
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
    expect(await database.select({
      afterSummary: adminAuditLogs.afterSummary,
      idempotencyKey: adminAuditLogs.idempotencyKey,
    }).from(adminAuditLogs).where(and(
      eq(adminAuditLogs.action, "production_job.created"),
      eq(adminAuditLogs.resourceId, job.id),
    ))).toEqual([{
      afterSummary: expect.objectContaining({
        websiteAnalyticsV2: {
          version: 1,
          event: "manual_order_created",
          occurredAt: "2026-08-20T01:00:00.000Z",
          amountPayableCents: 20_000,
          amountPaidBeforeCents: 0,
          amountPaidAfterCents: 4_500,
          initialStatus: "new",
          currency: "NZD",
        },
      }),
      idempotencyKey: expect.stringMatching(/^manual-finalization-/),
    }]);
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
    const updateIdempotencyKey = `analytics-failure-update-${created.job.id}`;
    await expect(repository.update({
      jobId: created.job.id,
      idempotencyKey: updateIdempotencyKey,
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
    expect(await database.select({
      afterSummary: adminAuditLogs.afterSummary,
      idempotencyKey: adminAuditLogs.idempotencyKey,
    }).from(adminAuditLogs).where(and(
      eq(adminAuditLogs.action, "production_job.updated"),
      eq(adminAuditLogs.resourceId, created.job.id),
      eq(adminAuditLogs.idempotencyKey, updateIdempotencyKey),
    ))).toEqual([{
      afterSummary: expect.objectContaining({
        websiteAnalyticsV2: {
          version: 1,
          event: "manual_payment_increased",
          occurredAt: "2026-08-20T03:30:00.000Z",
          amountPaidBeforeCents: 0,
          amountPaidAfterCents: 5_000,
          deltaCents: 5_000,
          currency: "NZD",
        },
      }),
      idempotencyKey: updateIdempotencyKey,
    }]);
  });

  it("records a positive manual payment delta in the authoritative AUD invoice currency", async () => {
    const job = await create({
      conversionEvidence: undefined,
      invoiceDraft: invoiceDraft(),
    });
    await database.update(invoices).set({ currency: "AUD" })
      .where(eq(invoices.jobId, job.id));
    const repository = createDrizzleProductionJobRepository(database, {
      conversionPolicy: policy,
      analyticsRecorder,
    });

    await expect(repository.update({
      jobId: job.id,
      idempotencyKey: `aud-payment-${job.id}`,
      expectedUpdatedAt: job.updatedAt,
      actor: { userId: actorId, email: `manual-finalization-${suffix}@example.test` },
      updatedAt: new Date("2026-08-20T04:30:00.000Z"),
      canUpdateFinance: true,
      finance: {
        manualPaymentStatus: "processing",
        amountPayableCents: 20_000,
        amountPaidCents: 5_000,
        artistFeeCents: 0,
        materialCostCents: 0,
      },
    })).resolves.toBe("updated");

    await expect(database.select().from(websiteAnalyticsFinancialEvents)
      .where(eq(websiteAnalyticsFinancialEvents.productionJobId, job.id)))
      .resolves.toEqual([expect.objectContaining({
        eventType: "receipt",
        amountCents: 5_000,
        currency: "AUD",
      })]);
  });

  it("replays a missed manual-order fact at immutable createdAt after a later edit", async () => {
    const realAnalytics = createWebsiteAnalyticsV2BusinessRecorder(database, {
      config: {
        enabled: false,
        cookieSecret: null,
        v2Enabled: true,
        attributionLookbackDays: 90,
      },
    });
    const replayAnalytics = {
      recordManualOrder: vi.fn()
        .mockRejectedValueOnce(new Error("synthetic first analytics miss"))
        .mockImplementation(realAnalytics.recordManualOrder),
      recordManualPaymentUpdate: realAnalytics.recordManualPaymentUpdate,
    };
    const baseRepository = createDrizzleProductionJobRepository(database, {
      conversionPolicy: policy,
      analyticsRecorder: replayAnalytics,
    });
    let committedInput: Parameters<typeof baseRepository.createManual>[0] | undefined;
    const capturingRepository = {
      ...baseRepository,
      createManual: vi.fn(async (input: Parameters<typeof baseRepository.createManual>[0]) => {
        committedInput = input;
        return baseRepository.createManual(input);
      }),
    };
    const runtime = createProductionJobService(capturingRepository, {
      createJobNumber: () => `MANUAL-${randomUUID()}`,
      now: () => finalizedAt,
    });
    const actor = {
      userId: actorId,
      email: `manual-finalization-${suffix}@example.test`,
    };
    const created = await runtime.createManual(
      actor,
      manualInput({ conversionEvidence: undefined }),
      { canUpdateFinance: true },
    );
    jobIds.push(created.job.id);
    expect(await database.select().from(websiteAnalyticsConversions)
      .where(eq(websiteAnalyticsConversions.productionJobId, created.job.id)))
      .toEqual([]);

    const editedAt = new Date("2026-08-20T06:00:00.000Z");
    await expect(baseRepository.update({
      jobId: created.job.id,
      idempotencyKey: `replay-edit-${created.job.id}`,
      expectedUpdatedAt: created.job.updatedAt,
      actor,
      updatedAt: editedAt,
      canUpdateFinance: true,
      internalNotes: "Synthetic later edit",
    })).resolves.toBe("updated");
    expect(committedInput).toBeDefined();
    await baseRepository.createManual(committedInput!);

    await expect(database.select().from(websiteAnalyticsConversions)
      .where(eq(websiteAnalyticsConversions.productionJobId, created.job.id)))
      .resolves.toEqual([expect.objectContaining({
        sourceId: created.job.id,
        occurredAt: finalizedAt,
      })]);
    expect(replayAnalytics.recordManualOrder).toHaveBeenLastCalledWith(
      expect.objectContaining({ occurredAt: finalizedAt }),
    );
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
