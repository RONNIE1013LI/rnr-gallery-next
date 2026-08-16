import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminAuditLogs,
  invoiceItems,
  invoices,
  productionJobs,
  user,
} from "@/server/db/schema";
import {
  createProductionJobService,
  parseProductionJobFilters,
} from "./production-job-service";
import {
  createDrizzleProductionJobRepository,
  getProductionJobDetail,
  listProductionAssignees,
  listProductionJobs,
} from "./drizzle-production-job-repository";
import { createDrizzleProductionProofRepository } from "./drizzle-production-proof-repository";
import { createProductionProofService } from "./production-proof-service";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");

const pool = new Pool({ connectionString: databaseUrl });
const database = drizzle(pool);
const suffix = randomUUID();
const actorId = `production-actor-${suffix}`;
const artistId = `production-artist-${suffix}`;
const formArtistId = `production-form-artist-${suffix}`;
const jobIds: string[] = [];

describe("drizzle production job repository", () => {
  beforeAll(async () => {
    await database.insert(user).values([
      { id: actorId, name: "Production Manager", email: `manager-${suffix}@example.test`, role: "admin" },
      { id: artistId, name: "Production Artist", email: `artist-${suffix}@example.test`, role: "staff" },
      { id: formArtistId, name: "Forms Artist", email: `forms-artist-${suffix}@example.test`, role: "form_staff" },
    ]);
  });

  afterAll(async () => {
    if (jobIds.length) {
      const savedInvoices = await database.select({ id: invoices.id }).from(invoices)
        .where(inArray(invoices.jobId, jobIds));
      const invoiceIds = savedInvoices.map((invoice) => invoice.id);
      if (invoiceIds.length) {
        await database.delete(adminAuditLogs).where(and(
          eq(adminAuditLogs.resourceType, "invoice"),
          inArray(adminAuditLogs.resourceId, invoiceIds),
        ));
        await database.delete(invoiceItems).where(inArray(invoiceItems.invoiceId, invoiceIds));
        await database.delete(invoices).where(inArray(invoices.id, invoiceIds));
      }
      await database.delete(adminAuditLogs).where(and(
        eq(adminAuditLogs.resourceType, "production_job"),
        inArray(adminAuditLogs.resourceId, jobIds),
      ));
      await database.delete(productionJobs).where(inArray(productionJobs.id, jobIds));
    }
    await database.delete(user).where(inArray(user.id, [actorId, artistId, formArtistId]));
    await pool.end();
  });

  it("creates, lists, redacts and updates one manual production job atomically", async () => {
    await expect(listProductionAssignees(database)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: actorId, role: "admin" }),
      expect.objectContaining({ id: artistId, role: "staff" }),
      expect.objectContaining({ id: formArtistId, role: "form_staff" }),
    ]));
    const repository = createDrizzleProductionJobRepository(database);
    const service = createProductionJobService(repository, {
      createJobNumber: () => `RRM-2026-${suffix.slice(0, 10).toUpperCase()}`,
      now: () => new Date("2026-08-04T10:00:00.000Z"),
    });
    const created = await service.createManual({
      userId: actorId,
      email: `manager-${suffix}@example.test`,
    }, {
      idempotencyKey: `manual-${suffix}`,
      customerName: "Manual Customer",
      customerEmail: "manual@example.test",
      customerPhone: "021 111 2222",
      customerSource: "messenger",
      urgent: true,
      neededDate: "2026-08-12",
      deliveryMethod: "post",
      assignedUserId: artistId,
      designRequirements: "Orange background",
      internalNotes: "Deposit expected",
      manualStatus: "new",
      manualPaymentStatus: "processing",
      amountPayableCents: 23_000,
      amountPaidCents: 10_000,
      artistFeeCents: 4_000,
      materialCostCents: 2_500,
      items: [{
        productTitle: "Roll-Up Banner",
        sizeLabel: "85 × 200 cm",
        quantity: 1,
        designText: "Happy birthday",
        notes: "Use main photo",
      }],
      invoiceDraft: {
        invoiceDate: "2026-08-04", dueDate: "2026-08-11", reference: "DRAFT",
        businessName: "R&R Gallery", businessAddress: "11 Para Close", businessEmail: "customerservice@rnrgallery.com",
        businessPhone: "+64 21 023 48948", businessWebsite: "https://rnrgallery.com/", gstNumber: "125-796-389", bankAccount: "04-2021-0317735-07",
        customerName: "Manual Customer", customerEmail: "manual@example.test", customerAddress: "11 Example Street", deliveryAddress: "11 Example Street",
        discountCents: 0, notes: "Thanks", terms: "Seven days", items: [{ code: "PRD", description: "Roll-Up Banner", quantityMilli: 1_000, rateInclGstCents: 23_000 }],
      },
    }, { canUpdateFinance: true });
    jobIds.push(created.job.id);

    await expect(database.select().from(invoices).where(eq(invoices.jobId, created.job.id)))
      .resolves.toEqual([expect.objectContaining({ invoiceNumber: `INV-${created.job.jobNumber}`, reference: created.job.jobNumber, totalInclGstCents: 23_000 })]);

    const staffList = await listProductionJobs(
      database,
      parseProductionJobFilters({ q: "Manual Customer", source: "manual" }),
      { canViewFinance: false },
    );
    expect(staffList.items).toHaveLength(1);
    expect(staffList.items[0]).toMatchObject({
      id: created.job.id,
      source: "manual",
      status: "new",
      paymentStatus: "processing",
      assignedUserName: "Production Artist",
      urgent: true,
      productTitles: ["Roll-Up Banner"],
      finance: null,
    });

    const adminDetail = await getProductionJobDetail(database, created.job.id, {
      canViewFinance: true,
    });
    expect(adminDetail).toMatchObject({
      job: { id: created.job.id, orderId: null },
      status: "new",
      paymentStatus: "processing",
      finance: {
        amountPayableCents: 23_000,
        amountPaidCents: 10_000,
        amountOwingCents: 13_000,
        artistFeeCents: 4_000,
        materialCostCents: 2_500,
        actualProfitCents: 3_500,
      },
      items: [expect.objectContaining({ productTitle: "Roll-Up Banner" })],
    });

    const updated = await createProductionJobService(repository, {
      now: () => new Date("2026-08-04T11:00:00.000Z"),
    }).update({
      userId: actorId,
      email: `manager-${suffix}@example.test`,
    }, {
      jobId: created.job.id,
      idempotencyKey: `update-${suffix}`,
      expectedUpdatedAt: adminDetail!.job.updatedAt.toISOString(),
      manualStatus: "designing",
      milestones: { fileSent: true },
      finance: {
        manualPaymentStatus: "paid",
        amountPayableCents: 23_000,
        amountPaidCents: 23_000,
        artistFeeCents: 4_000,
        materialCostCents: 2_500,
      },
    }, { canUpdateFinance: true });
    expect(updated).toBe("updated");

    const refreshed = await getProductionJobDetail(database, created.job.id, {
      canViewFinance: true,
    });
    expect(refreshed).toMatchObject({
      status: "designing",
      paymentStatus: "paid",
      finance: { amountOwingCents: 0, actualProfitCents: 16_500 },
    });
    expect(refreshed?.job.fileSentAt).toEqual(new Date("2026-08-04T11:00:00.000Z"));
    expect(await database.select().from(adminAuditLogs).where(and(
      eq(adminAuditLogs.resourceType, "production_job"),
      eq(adminAuditLogs.resourceId, created.job.id),
    ))).toHaveLength(2);
  });

  it("versions private drafts, redacts payment proofs and keeps proof decisions immutable", async () => {
    const jobs = createProductionJobService(createDrizzleProductionJobRepository(database), {
      createJobNumber: () => `RRM-2026-${suffix.slice(-10).toUpperCase()}`,
      now: () => new Date("2026-08-04T12:00:00.000Z"),
    });
    const created = await jobs.createManual({ userId: actorId, email: `manager-${suffix}@example.test` }, {
      idempotencyKey: `proof-job-${suffix}`,
      customerName: "Proof Customer", customerEmail: "proof@example.test", customerPhone: "",
      customerSource: "email", urgent: false, neededDate: "2026-08-15", deliveryMethod: "pickup",
      assignedUserId: artistId, designRequirements: "Review draft", internalNotes: "",
      manualStatus: "designing", manualPaymentStatus: "paid", amountPayableCents: 10000,
      amountPaidCents: 10000, artistFeeCents: 1000, materialCostCents: 500,
      items: [{ productTitle: "Canvas", sizeLabel: "A2", quantity: 1, designText: "", notes: "" }],
    }, { canUpdateFinance: true });
    jobIds.push(created.job.id);
    const proof = createProductionProofService(createDrizzleProductionProofRepository(database), {
      now: () => new Date("2026-08-04T12:30:00.000Z"),
    });
    const draftOneId = randomUUID();
    const draftTwoId = randomUUID();
    const paymentId = randomUUID();
    const baseReference = { originalName: "draft.jpg", mimeType: "image/jpeg" as const, size: 3, sha256: "a".repeat(64) };
    const first = await proof.registerFile({ userId: actorId, email: `manager-${suffix}@example.test` }, created.job.id, {
      kind: "design_draft", idempotencyKey: `draft-1-${suffix}`,
      reference: { ...baseReference, id: draftOneId, storageKey: `${draftOneId}.bin` },
    }, { canManageFinance: true });
    const second = await proof.registerFile({ userId: actorId, email: `manager-${suffix}@example.test` }, created.job.id, {
      kind: "design_draft", idempotencyKey: `draft-2-${suffix}`,
      reference: { ...baseReference, id: draftTwoId, storageKey: `${draftTwoId}.bin`, sha256: "b".repeat(64) },
    }, { canManageFinance: true });
    await proof.registerFile({ userId: actorId, email: `manager-${suffix}@example.test` }, created.job.id, {
      kind: "payment_proof", idempotencyKey: `payment-${suffix}`,
      reference: { ...baseReference, id: paymentId, storageKey: `${paymentId}.bin`, originalName: "payment.jpg", sha256: "c".repeat(64) },
    }, { canManageFinance: true });
    expect(first.file.version).toBe(1);
    expect(second.file.version).toBe(2);

    await expect(proof.recordReview({ userId: actorId, email: `manager-${suffix}@example.test` }, created.job.id, {
      fileId: draftOneId, decision: "changes_requested", notes: "Move the title", idempotencyKey: `review-1-${suffix}`,
    })).resolves.toMatchObject({ result: "created" });
    await expect(proof.recordReview({ userId: actorId, email: `manager-${suffix}@example.test` }, created.job.id, {
      fileId: draftOneId, decision: "approved", notes: "", idempotencyKey: `review-2-${suffix}`,
    })).rejects.toMatchObject({ name: "ProductionProofConflictError" });

    const staffFiles = await proof.listFiles(created.job.id, { canViewFinance: false });
    const adminFiles = await proof.listFiles(created.job.id, { canViewFinance: true });
    expect(staffFiles.files).toHaveLength(2);
    expect(adminFiles.files).toHaveLength(3);
    expect(staffFiles.revision).toEqual({ changesRequested: 1, freeRevisionsRemaining: 1, requiresAdditionalChargeReview: false });
    expect(staffFiles.files.some((file) => file.kind === "payment_proof")).toBe(false);
  });
});
