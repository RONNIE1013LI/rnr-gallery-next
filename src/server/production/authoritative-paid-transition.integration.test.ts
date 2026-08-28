import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminAuditLogs,
  analyticsConversionDeliveries,
  invoices,
  productionJobs,
  user,
} from "@/server/db/schema";
import {
  createDrizzleProductionJobRepository,
  recordManualConversionEvidence,
} from "./drizzle-production-job-repository";
import { createProductionJobService } from "./production-job-service";
import { assertIsolatedTestDatabaseUrl } from "../../../scripts/migration-safety";

const databaseUrl = assertIsolatedTestDatabaseUrl(
  process.env.TEST_DATABASE_URL,
  process.env,
).url;
const pool = new Pool({ connectionString: databaseUrl, max: 10 });
const database = drizzle(pool);
const suffix = randomUUID();
const actorId = `phase0d-actor-${suffix}`;
const jobIds: string[] = [];
const activation = new Date("2026-08-01T00:00:00.000Z");
const policy = Object.freeze({
  google: Object.freeze({ enabled: true, activatedAt: activation }),
  meta: Object.freeze({ enabled: true, activatedAt: activation }),
});

async function createJob(input: Readonly<{
  platform?: "google" | "meta";
  consent?: "granted" | "denied" | "unknown";
  createdAt?: Date;
}> = {}) {
  const id = randomUUID();
  const createdAt = input.createdAt ?? new Date("2026-08-20T01:00:00.000Z");
  const platform = input.platform ?? "meta";
  const [job] = await database.insert(productionJobs).values({
    id,
    jobNumber: `PHASE0D-${id}`,
    source: "manual",
    idempotencyKey: `phase0d:${id}`,
    requestDigest: "d".repeat(64),
    customerName: "Synthetic Customer",
    customerEmail: "synthetic@example.test",
    customerPhone: "+64 21 000 0000",
    customerSource: platform === "meta" ? "messenger" : "other",
    webOrderNumber: "",
    manualStatus: "new",
    manualPaymentStatus: "processing",
    urgent: false,
    neededDate: "2026-09-01",
    deliveryMethod: "post",
    amountPayableCents: 20_000,
    amountPaidCents: 0,
    artistFeeCents: 0,
    materialCostCents: 0,
    createdByUserId: actorId,
    createdAt,
    updatedAt: createdAt,
  }).returning();
  jobIds.push(id);
  await database.insert(invoices).values({
    jobId: id,
    invoiceNumber: `INV-${id}`,
    status: "issued",
    invoiceDate: "2026-08-20",
    dueDate: "2026-08-27",
    reference: job.jobNumber,
    businessName: "R&R Gallery",
    businessAddress: "Auckland",
    businessEmail: "customerservice@rnrgallery.com",
    businessPhone: "+64 21 023 48948",
    businessWebsite: "https://rnrgallery.com/",
    gstNumber: "TEST",
    bankAccount: "TEST",
    customerName: "Synthetic Customer",
    customerEmail: "synthetic@example.test",
    currency: "NZD",
    grossCents: 20_000,
    discountCents: 0,
    subtotalExGstCents: 17_391,
    gstCents: 2_609,
    totalInclGstCents: 20_000,
    issuedAt: createdAt,
    createdByUserId: actorId,
    updatedByUserId: actorId,
    createdAt,
    updatedAt: createdAt,
  });
  if (input.consent !== "unknown") {
    expect(await recordManualConversionEvidence(database, {
      jobId: id,
      actor: { userId: actorId, email: `phase0d-${suffix}@example.test` },
      consentDecision: input.consent ?? "granted",
      consentRecordedAt: createdAt,
      source: platform,
      ...(input.consent === "denied"
        ? {}
        : platform === "meta"
          ? { attribution: { fbp: "fb.1.1720000000000.123456789" } }
          : { attribution: { gclid: "synthetic-gclid" } }),
    })).toBe("recorded");
  }
  return job;
}

function paidUpdate(job: typeof productionJobs.$inferSelect, idempotencyKey: string, updatedAt = new Date("2026-08-20T02:00:00.000Z")) {
  return {
    jobId: job.id,
    idempotencyKey,
    expectedUpdatedAt: job.updatedAt,
    actor: { userId: actorId, email: `phase0d-${suffix}@example.test` },
    updatedAt,
    canUpdateFinance: true,
    finance: {
      manualPaymentStatus: "paid" as const,
      amountPayableCents: 20_000,
      amountPaidCents: 20_000,
      artistFeeCents: 0,
      materialCostCents: 0,
    },
  };
}

describe("authoritative paid transition", () => {
  beforeAll(async () => {
    await database.insert(user).values({
      id: actorId,
      name: "Phase 0D Test Actor",
      email: `phase0d-${suffix}@example.test`,
      role: "admin",
    });
  });

  afterAll(async () => {
    if (jobIds.length) {
      await database.delete(analyticsConversionDeliveries).where(inArray(analyticsConversionDeliveries.jobId, jobIds));
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

  it("commits the first paid state, database timestamp and eligible outbox row atomically", async () => {
    const job = await createJob();
    const before = new Date();
    const result = await createDrizzleProductionJobRepository(database, { conversionPolicy: policy })
      .update(paidUpdate(job, `paid-${job.id}`));
    const after = new Date();
    expect(result).toBe("updated");
    const [persisted] = await database.select().from(productionJobs).where(eq(productionJobs.id, job.id));
    expect(persisted.manualPaymentStatus).toBe("paid");
    expect(persisted.manualPaymentConfirmedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(persisted.manualPaymentConfirmedAt!.getTime()).toBeLessThanOrEqual(after.getTime());
    const rows = await database.select().from(analyticsConversionDeliveries).where(eq(analyticsConversionDeliveries.jobId, job.id));
    expect(rows).toEqual([expect.objectContaining({
      platform: "meta",
      transactionId: `manual-order:${job.id}`,
      status: "pending",
      valueMinor: 20_000,
    })]);
  });

  it("records evidence only through the trusted server path before payment", async () => {
    const job = await createJob({ consent: "unknown" });
    expect(await recordManualConversionEvidence(database, {
      jobId: job.id,
      actor: { userId: actorId, email: `phase0d-${suffix}@example.test` },
      consentDecision: "granted",
      consentRecordedAt: job.createdAt,
      source: "google",
      attribution: { gclid: "synthetic-trusted-path" },
    })).toBe("recorded");
    const repository = createDrizzleProductionJobRepository(database, { conversionPolicy: policy });
    expect(await repository.update(paidUpdate(job, `trusted-${job.id}`))).toBe("updated");
    expect(await recordManualConversionEvidence(database, {
      jobId: job.id,
      actor: { userId: actorId, email: `phase0d-${suffix}@example.test` },
      consentDecision: "granted",
      consentRecordedAt: new Date("2026-08-20T03:00:00.000Z"),
      source: "google",
      attribution: { gclid: "synthetic-late-write" },
    })).toBe("already_paid");
    expect(await database.select().from(analyticsConversionDeliveries)
      .where(eq(analyticsConversionDeliveries.jobId, job.id))).toHaveLength(1);
  });

  it("creates one immutable outbox row when a new manual order is initially paid", async () => {
    const repository = createDrizzleProductionJobRepository(database, { conversionPolicy: policy });
    const service = createProductionJobService(repository, {
      createJobNumber: () => `PHASE0D-INITIAL-${suffix}`,
      now: () => new Date("2026-08-20T01:00:00.000Z"),
    });
    const result = await service.createManual({
      userId: actorId,
      email: `phase0d-${suffix}@example.test`,
    }, {
      idempotencyKey: `phase0d-initial-${suffix}`,
      customerName: "Synthetic Initial Paid",
      customerEmail: "synthetic-initial@example.test",
      customerPhone: "+64 21 000 0001",
      customerSource: "messenger",
      webOrderNumber: "",
      urgent: false,
      neededDate: "2026-09-01",
      deliveryMethod: "post",
      deliveryAddress: "Synthetic address",
      paymentReconciliationStatus: "Arrive",
      assignedUserId: null,
      designRequirements: "Synthetic design requirement",
      internalNotes: "",
      manualStatus: "new",
      manualPaymentStatus: "paid",
      amountPayableCents: 20_000,
      amountPaidCents: 20_000,
      artistFeeCents: 0,
      materialCostCents: 0,
      conversionEvidence: {
        consentDecision: "granted",
        consentRecordedAt: "2026-08-20T00:30:00.000Z",
        source: "meta",
        attribution: { fbp: "fb.1.1720000000000.123456789" },
      },
      invoiceDraft: {
        invoiceDate: "2026-08-20", dueDate: "2026-08-27", reference: "DRAFT",
        businessName: "R&R Gallery", businessAddress: "Auckland", businessEmail: "customerservice@rnrgallery.com",
        businessPhone: "+64 21 023 48948", businessWebsite: "https://rnrgallery.com/", gstNumber: "TEST", bankAccount: "TEST",
        customerName: "Synthetic Initial Paid", customerEmail: "synthetic-initial@example.test", customerAddress: "Synthetic address", deliveryAddress: "Synthetic address",
        discountCents: 0, notes: "", terms: "", items: [{ code: "TEST", description: "Synthetic item", quantityMilli: 1_000, rateInclGstCents: 20_000 }],
      },
      customFields: [],
      items: [{
        productTitle: "Synthetic Canvas",
        sizeLabel: "A3",
        quantity: 1,
        designText: "",
        notes: "",
      }],
    }, { canUpdateFinance: true });
    jobIds.push(result.job.id);

    const [job] = await database.select().from(productionJobs)
      .where(eq(productionJobs.id, result.job.id));
    expect(job.manualPaymentStatus).toBe("paid");
    expect(job.manualPaymentConfirmedAt).toBeInstanceOf(Date);
    expect(await database.select().from(analyticsConversionDeliveries)
      .where(eq(analyticsConversionDeliveries.jobId, result.job.id))).toEqual([
      expect.objectContaining({
        platform: "meta",
        transactionId: `manual-order:${result.job.id}`,
        status: "pending",
        valueMinor: 20_000,
      }),
    ]);
  });

  it("rolls an initially paid manual order back if its outbox cannot be persisted", async () => {
    const repository = createDrizzleProductionJobRepository(database, {
      conversionPolicy: policy,
      enqueueDeliveries: async () => { throw new Error("synthetic initial outbox failure"); },
    });
    const service = createProductionJobService(repository, {
      createJobNumber: () => `PHASE0D-ROLLBACK-${suffix}`,
      now: () => new Date("2026-08-20T01:00:00.000Z"),
    });
    await expect(service.createManual({
      userId: actorId,
      email: `phase0d-${suffix}@example.test`,
    }, {
      idempotencyKey: `phase0d-initial-rollback-${suffix}`,
      customerName: "Synthetic Rollback",
      customerEmail: "synthetic-rollback@example.test",
      customerPhone: "+64 21 000 0002",
      customerSource: "messenger",
      webOrderNumber: "",
      urgent: false,
      neededDate: "2026-09-01",
      deliveryMethod: "post",
      deliveryAddress: "Synthetic address",
      paymentReconciliationStatus: "Arrive",
      assignedUserId: null,
      designRequirements: "Synthetic design requirement",
      internalNotes: "",
      manualStatus: "new",
      manualPaymentStatus: "paid",
      amountPayableCents: 20_000,
      amountPaidCents: 20_000,
      artistFeeCents: 0,
      materialCostCents: 0,
      conversionEvidence: {
        consentDecision: "granted",
        consentRecordedAt: "2026-08-20T00:30:00.000Z",
        source: "meta",
        attribution: { fbp: "fb.1.1720000000000.123456789" },
      },
      invoiceDraft: {
        invoiceDate: "2026-08-20", dueDate: "2026-08-27", reference: "DRAFT",
        businessName: "R&R Gallery", businessAddress: "Auckland", businessEmail: "customerservice@rnrgallery.com",
        businessPhone: "+64 21 023 48948", businessWebsite: "https://rnrgallery.com/", gstNumber: "TEST", bankAccount: "TEST",
        customerName: "Synthetic Rollback", customerEmail: "synthetic-rollback@example.test", customerAddress: "Synthetic address", deliveryAddress: "Synthetic address",
        discountCents: 0, notes: "", terms: "", items: [{ code: "TEST", description: "Synthetic item", quantityMilli: 1_000, rateInclGstCents: 20_000 }],
      },
      customFields: [],
      items: [{ productTitle: "Synthetic Canvas", sizeLabel: "A3", quantity: 1, designText: "", notes: "" }],
    }, { canUpdateFinance: true })).rejects.toThrow("synthetic initial outbox failure");

    expect(await database.select().from(productionJobs).where(eq(
      productionJobs.idempotencyKey,
      `phase0d-initial-rollback-${suffix}`,
    ))).toEqual([]);
  });

  it("rolls payment state back when outbox insertion fails", async () => {
    const job = await createJob();
    const repository = createDrizzleProductionJobRepository(database, {
      conversionPolicy: policy,
      enqueueDeliveries: async () => { throw new Error("synthetic outbox failure"); },
    });
    await expect(repository.update(paidUpdate(job, `rollback-${job.id}`))).rejects.toThrow("synthetic outbox failure");
    const [persisted] = await database.select().from(productionJobs).where(eq(productionJobs.id, job.id));
    expect(persisted.manualPaymentStatus).toBe("processing");
    expect(persisted.manualPaymentConfirmedAt).toBeNull();
    expect(await database.select().from(analyticsConversionDeliveries).where(eq(analyticsConversionDeliveries.jobId, job.id))).toEqual([]);
  });

  it("creates no outbox on conflict or paid-to-paid saves and preserves first confirmation", async () => {
    const job = await createJob();
    const repository = createDrizzleProductionJobRepository(database, { conversionPolicy: policy });
    expect(await repository.update({ ...paidUpdate(job, `first-${job.id}`), expectedUpdatedAt: new Date(0) })).toBe("conflict");
    expect(await database.select().from(analyticsConversionDeliveries).where(eq(analyticsConversionDeliveries.jobId, job.id))).toEqual([]);
    expect(await repository.update(paidUpdate(job, `second-${job.id}`))).toBe("updated");
    const [paid] = await database.select().from(productionJobs).where(eq(productionJobs.id, job.id));
    const firstConfirmedAt = paid.manualPaymentConfirmedAt;
    expect(await repository.update(paidUpdate(paid, `third-${job.id}`, new Date("2026-08-20T03:00:00.000Z")))).toBe("updated");
    const [saved] = await database.select().from(productionJobs).where(eq(productionJobs.id, job.id));
    expect(saved.manualPaymentConfirmedAt).toEqual(firstConfirmedAt);
    expect(await database.select().from(analyticsConversionDeliveries).where(eq(analyticsConversionDeliveries.jobId, job.id))).toHaveLength(1);
  });

  it("preserves the first payment lifecycle and never creates a second purchase after reversal", async () => {
    const job = await createJob();
    const repository = createDrizzleProductionJobRepository(database, { conversionPolicy: policy });
    await repository.update(paidUpdate(job, `lifecycle-paid-${job.id}`));
    const [paid] = await database.select().from(productionJobs)
      .where(eq(productionJobs.id, job.id));
    const firstConfirmedAt = paid.manualPaymentConfirmedAt;

    await repository.update({
      ...paidUpdate(paid, `lifecycle-reversed-${job.id}`, new Date("2026-08-20T03:00:00.000Z")),
      finance: {
        manualPaymentStatus: "processing",
        amountPayableCents: 20_000,
        amountPaidCents: 0,
        artistFeeCents: 0,
        materialCostCents: 0,
      },
    });
    const [reversed] = await database.select().from(productionJobs)
      .where(eq(productionJobs.id, job.id));
    await repository.update(paidUpdate(
      reversed,
      `lifecycle-repaid-${job.id}`,
      new Date("2026-08-20T04:00:00.000Z"),
    ));

    const [repaid] = await database.select().from(productionJobs)
      .where(eq(productionJobs.id, job.id));
    expect(repaid.manualPaymentConfirmedAt).toEqual(firstConfirmedAt);
    expect(await database.select().from(analyticsConversionDeliveries)
      .where(eq(analyticsConversionDeliveries.jobId, job.id))).toHaveLength(1);
  });

  it("allows only one platform row under concurrent paid requests", async () => {
    const job = await createJob({ platform: "google" });
    const repository = createDrizzleProductionJobRepository(database, { conversionPolicy: policy });
    const results = await Promise.all([
      repository.update(paidUpdate(job, `concurrent-a-${job.id}`)),
      repository.update(paidUpdate(job, `concurrent-b-${job.id}`)),
    ]);
    expect(results.sort()).toEqual(["conflict", "updated"]);
    const rows = await database.select().from(analyticsConversionDeliveries).where(eq(analyticsConversionDeliveries.jobId, job.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ platform: "google", transactionId: `manual-order:${job.id}` });
  });

  it.each(["denied", "unknown"] as const)("does not enqueue when consent is %s", async (consent) => {
    const job = await createJob({ consent });
    expect(await createDrizzleProductionJobRepository(database, { conversionPolicy: policy })
      .update(paidUpdate(job, `${consent}-${job.id}`))).toBe("updated");
    expect(await database.select().from(analyticsConversionDeliveries).where(eq(analyticsConversionDeliveries.jobId, job.id))).toEqual([]);
  });

  it("does not create executable history before activation", async () => {
    const job = await createJob({ createdAt: new Date("2026-07-01T00:00:00.000Z") });
    expect(await createDrizzleProductionJobRepository(database, { conversionPolicy: policy })
      .update(paidUpdate(job, `historical-${job.id}`))).toBe("updated");
    expect(await database.select().from(analyticsConversionDeliveries).where(eq(analyticsConversionDeliveries.jobId, job.id))).toEqual([]);
  });

  it("keeps the immutable snapshot unchanged after a later job edit", async () => {
    const job = await createJob();
    const repository = createDrizzleProductionJobRepository(database, { conversionPolicy: policy });
    await repository.update(paidUpdate(job, `snapshot-paid-${job.id}`));
    const [paid] = await database.select().from(productionJobs).where(eq(productionJobs.id, job.id));
    const [before] = await database.select().from(analyticsConversionDeliveries).where(eq(analyticsConversionDeliveries.jobId, job.id));
    await repository.update({
      jobId: job.id,
      idempotencyKey: `snapshot-edit-${job.id}`,
      expectedUpdatedAt: paid.updatedAt,
      actor: { userId: actorId, email: `phase0d-${suffix}@example.test` },
      updatedAt: new Date("2026-08-20T04:00:00.000Z"),
      canUpdateFinance: false,
      customerEmail: "changed@example.test",
    });
    const [after] = await database.select().from(analyticsConversionDeliveries).where(eq(analyticsConversionDeliveries.jobId, job.id));
    expect(after.consentSnapshot).toEqual(before.consentSnapshot);
    expect(after.attributionSnapshot).toEqual(before.attributionSnapshot);
    expect(after.userDataSnapshot).toEqual(before.userDataSnapshot);
  });
});
