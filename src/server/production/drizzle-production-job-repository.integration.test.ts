import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminAuditLogs,
  internalNotificationOutbox,
  internalNotificationRecipients,
  internalNotificationSubscriptions,
  invoiceItems,
  invoices,
  productionJobs,
  productionJobFiles,
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
import { enqueueInternalNotifications } from "@/server/notifications/drizzle-internal-notification-outbox-repository";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");

const pool = new Pool({ connectionString: databaseUrl });
const database = drizzle(pool);
const suffix = randomUUID();
const actorId = `production-actor-${suffix}`;
const artistId = `production-artist-${suffix}`;
const formArtistId = `production-form-artist-${suffix}`;
const notificationRecipientId = randomUUID();
const notificationRecipientEmail = `production-notifications-${suffix}@example.test`;
const jobIds: string[] = [];

describe("drizzle production job repository", () => {
  beforeAll(async () => {
    await database.insert(user).values([
      { id: actorId, name: "Production Manager", email: `manager-${suffix}@example.test`, role: "admin" },
      { id: artistId, name: "Production Artist", email: `artist-${suffix}@example.test`, role: "staff" },
      { id: formArtistId, name: "Forms Artist", email: `forms-artist-${suffix}@example.test`, role: "form_staff" },
    ]);
    const createdAt = new Date("2026-08-04T09:00:00.000Z");
    await database.insert(internalNotificationRecipients).values({
      id: notificationRecipientId,
      email: notificationRecipientEmail,
      status: "active",
      verifiedAt: createdAt,
      createdByUserId: actorId,
      createdAt,
      updatedAt: createdAt,
    });
    await database.insert(internalNotificationSubscriptions).values({
      recipientId: notificationRecipientId,
      topic: "manual_order_created",
      createdAt,
      updatedAt: createdAt,
    });
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
    await database.delete(internalNotificationOutbox)
      .where(eq(internalNotificationOutbox.recipientId, notificationRecipientId));
    await database.delete(internalNotificationRecipients)
      .where(eq(internalNotificationRecipients.id, notificationRecipientId));
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
    const actor = {
      userId: actorId,
      email: `manager-${suffix}@example.test`,
    };
    const createInput = {
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
    };
    const created = await service.createManual(actor, createInput, { canUpdateFinance: true });
    jobIds.push(created.job.id);
    expect(created.job.updatedAt).toEqual(new Date("2026-08-04T10:00:00.000Z"));

    await expect(service.createManual(actor, createInput, { canUpdateFinance: true }))
      .resolves.toMatchObject({ result: "duplicate", job: { id: created.job.id } });
    await expect(database.select().from(internalNotificationOutbox).where(eq(
      internalNotificationOutbox.sourceEventId,
      created.job.id,
    ))).resolves.toEqual([
      expect.objectContaining({
        eventKey: `manual_order_created:${created.job.id}:${notificationRecipientId}`,
        topic: "manual_order_created",
        resourceType: "production_job",
        resourceId: created.job.id,
        resourceReference: created.job.jobNumber,
        recipientEmail: notificationRecipientEmail,
        payload: { version: 1, adminPath: `/admin/jobs/${created.job.id}` },
      }),
    ]);

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
      customerName: "Updated Manual Customer",
      customerEmail: "updated-manual@example.test",
      customerPhone: "+64 21 999 8888",
      manualStatus: "designing",
      milestones: { fileSent: true },
      finance: {
        manualPaymentStatus: "paid",
        amountPayableCents: 23_000,
        amountPaidCents: 23_000,
        artistFeeCents: 4_000,
        materialCostCents: 2_500,
      },
      items: [{
        productTitle: "Canvas",
        sizeLabel: "A1",
        quantity: 1,
        designText: "Updated wording",
        notes: "Updated item note",
      }],
    }, { canUpdateFinance: true });
    expect(updated).toBe("updated");

    const refreshed = await getProductionJobDetail(database, created.job.id, {
      canViewFinance: true,
    });
    expect(refreshed).toMatchObject({
      job: {
        customerName: "Updated Manual Customer",
        customerEmail: "updated-manual@example.test",
        customerPhone: "+64 21 999 8888",
      },
      status: "designing",
      paymentStatus: "paid",
      finance: { amountOwingCents: 0, actualProfitCents: 16_500 },
      items: [{ productTitle: "Canvas", sizeLabel: "A1", designText: "Updated wording", notes: "Updated item note" }],
    });
    expect(refreshed?.job.fileSentAt).toEqual(new Date("2026-08-04T11:00:00.000Z"));
    const auditRows = await database.select().from(adminAuditLogs).where(and(
      eq(adminAuditLogs.resourceType, "production_job"),
      eq(adminAuditLogs.resourceId, created.job.id),
    ));
    expect(auditRows).toHaveLength(2);
    expect(auditRows.find((entry) => entry.action === "production_job.updated")?.afterSummary).toMatchObject({
      changedFields: [
        "customerName", "customerEmail", "customerPhone", "manualStatus",
        "fileSentAt", "manualPaymentStatus", "amountPaidCents", "items",
      ],
      changes: [
        { field: "customerName" },
        { field: "customerEmail" },
        { field: "customerPhone" },
        { field: "manualStatus", before: "new", after: "designing" },
        { field: "fileSentAt", before: "NO", after: "YES" },
        { field: "manualPaymentStatus", before: "processing", after: "paid" },
        { field: "amountPaidCents", before: "$100.00", after: "$230.00" },
        { field: "items" },
      ],
    });
    await expect(repository.deleteManual({
      actor: { userId: actorId, email: `manager-${suffix}@example.test` },
      jobId: created.job.id,
      expectedJobNumber: created.job.jobNumber,
      idempotencyKey: `delete-invoiced-${suffix}`,
    })).resolves.toMatchObject({ result: "deleted", jobNumber: created.job.jobNumber });
    await expect(database.select({ id: productionJobs.id }).from(productionJobs)
      .where(eq(productionJobs.id, created.job.id))).resolves.toHaveLength(0);
    await expect(database.select({ id: invoices.id }).from(invoices)
      .where(eq(invoices.jobId, created.job.id))).resolves.toHaveLength(0);
  });

  it("rolls back internal notification enqueue with the outer business transaction", async () => {
    const sourceEventId = randomUUID();
    await expect(database.transaction(async (transaction) => {
      const inserted = await enqueueInternalNotifications(transaction, {
        topic: "manual_order_created",
        sourceEventId,
        resourceType: "production_job",
        resourceId: sourceEventId,
        resourceReference: `ROLLBACK-${suffix.slice(0, 8)}`,
        payload: { version: 1, adminPath: `/admin/jobs/${sourceEventId}` },
        createdAt: new Date("2026-08-24T09:00:00.000Z"),
      });
      expect(inserted).toBe(1);
      throw new Error("rollback-test");
    })).rejects.toThrow("rollback-test");

    await expect(database.select().from(internalNotificationOutbox).where(eq(
      internalNotificationOutbox.sourceEventId,
      sourceEventId,
    ))).resolves.toEqual([]);
  });

  it("creates a manual order successfully with zero eligible notification recipients", async () => {
    let createdJobId: string | null = null;
    await database.delete(internalNotificationSubscriptions).where(and(
      eq(internalNotificationSubscriptions.recipientId, notificationRecipientId),
      eq(internalNotificationSubscriptions.topic, "manual_order_created"),
    ));
    try {
      const service = createProductionJobService(
        createDrizzleProductionJobRepository(database),
        {
          createJobNumber: () => `RRM-ZERO-${suffix.slice(0, 8).toUpperCase()}`,
          now: () => new Date("2026-08-24T09:30:00.000Z"),
        },
      );
      const result = await service.createManual({
        userId: actorId,
        email: `manager-${suffix}@example.test`,
      }, {
        idempotencyKey: `manual-zero-recipient-${suffix}`,
        customerName: "Zero Recipient Manual",
        customerEmail: "",
        customerPhone: "021 000 0000",
        customerSource: "phone",
        urgent: false,
        neededDate: "2026-09-01",
        deliveryMethod: "pickup",
        assignedUserId: null,
        designRequirements: "Zero recipient transaction",
        internalNotes: "",
        manualStatus: "new",
        manualPaymentStatus: "awaiting_payment",
        amountPayableCents: 0,
        amountPaidCents: 0,
        artistFeeCents: 0,
        materialCostCents: 0,
        items: [{
          productTitle: "Canvas",
          sizeLabel: "A4",
          quantity: 1,
          designText: "",
          notes: "",
        }],
      }, { canUpdateFinance: true });
      expect(result).toMatchObject({ result: "created" });
      createdJobId = result.job.id;
      jobIds.push(createdJobId);
      await expect(database.select().from(internalNotificationOutbox).where(eq(
        internalNotificationOutbox.sourceEventId,
        createdJobId,
      ))).resolves.toEqual([]);
    } finally {
      await database.insert(internalNotificationSubscriptions).values({
        recipientId: notificationRecipientId,
        topic: "manual_order_created",
        createdAt: new Date("2026-08-04T09:00:00.000Z"),
        updatedAt: new Date("2026-08-04T09:00:00.000Z"),
      }).onConflictDoNothing();
      if (createdJobId) {
        await database.delete(internalNotificationOutbox).where(eq(
          internalNotificationOutbox.sourceEventId,
          createdJobId,
        ));
        await database.delete(adminAuditLogs).where(and(
          eq(adminAuditLogs.resourceType, "production_job"),
          eq(adminAuditLogs.resourceId, createdJobId),
        ));
        await database.delete(productionJobs).where(eq(productionJobs.id, createdJobId));
      }
    }
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

    const staffFiles = await proof.listFiles(created.job.id, { canViewFinance: false, canViewPaymentProof: false });
    const financeOnlyFiles = await proof.listFiles(created.job.id, { canViewFinance: true, canViewPaymentProof: false });
    const paymentProofFiles = await proof.listFiles(created.job.id, { canViewFinance: false, canViewPaymentProof: true });
    expect(staffFiles.files).toHaveLength(2);
    expect(financeOnlyFiles.files).toHaveLength(2);
    expect(paymentProofFiles.files).toHaveLength(3);
    expect(staffFiles.revision).toEqual({ changesRequested: 1, freeRevisionsRemaining: 1, requiresAdditionalChargeReview: false });
    expect(staffFiles.files.some((file) => file.kind === "payment_proof")).toBe(false);
    expect(financeOnlyFiles.files.some((file) => file.kind === "payment_proof")).toBe(false);
    expect(paymentProofFiles.files.some((file) => file.kind === "payment_proof")).toBe(true);
  });

  it("hard-deletes a manual order while retaining a deletion audit and returning storage cleanup keys", async () => {
    const repository = createDrizzleProductionJobRepository(database) as ReturnType<typeof createDrizzleProductionJobRepository> & {
      deleteManual: (input: {
        actor: { userId: string; email: string };
        jobId: string;
        expectedJobNumber: string;
        idempotencyKey: string;
      }) => Promise<{ result: string; jobNumber: string; files: readonly { id: string; storageKey: string }[] }>;
    };
    expect(repository.deleteManual).toBeTypeOf("function");

    const jobId = randomUUID();
    const fileId = randomUUID();
    const jobNumber = `DELETE-${suffix.slice(0, 8)}`;
    jobIds.push(jobId);
    await database.insert(productionJobs).values({
      id: jobId,
      jobNumber,
      source: "manual",
      idempotencyKey: `delete-seed-${suffix}`,
      requestDigest: "d".repeat(64),
      customerName: "Delete Test",
      customerEmail: "",
      customerPhone: "0210000000",
      customerSource: "phone",
      manualStatus: "new",
      manualPaymentStatus: "awaiting_payment",
      urgent: false,
      neededDate: "2026-08-30",
      deliveryMethod: "pickup",
      amountPayableCents: 0,
      amountPaidCents: 0,
      artistFeeCents: 0,
      materialCostCents: 0,
      createdByUserId: actorId,
    });
    await database.insert(productionJobFiles).values({
      id: fileId,
      jobId,
      kind: "payment_proof",
      originalName: "delete-test.jpg",
      mediaType: "image/jpeg",
      sizeBytes: 3,
      storageKey: `private-uploads/${fileId}.bin`,
      sha256: "a".repeat(64),
      idempotencyKey: `delete-file-${suffix}`,
      requestDigest: "b".repeat(64),
      uploadedByUserId: actorId,
    });

    await expect(repository.deleteManual({
      actor: { userId: actorId, email: `manager-${suffix}@example.test` },
      jobId,
      expectedJobNumber: "WRONG",
      idempotencyKey: `delete-wrong-ref-${suffix}`,
    })).rejects.toThrow("The order reference does not match");
    await expect(database.select({ id: productionJobs.id }).from(productionJobs)
      .where(eq(productionJobs.id, jobId))).resolves.toHaveLength(1);

    await expect(repository.deleteManual({
      actor: { userId: actorId, email: `manager-${suffix}@example.test` },
      jobId,
      expectedJobNumber: jobNumber,
      idempotencyKey: `delete-order-${suffix}`,
    })).resolves.toEqual({
      result: "deleted",
      jobNumber,
      files: [{ id: fileId, storageKey: `private-uploads/${fileId}.bin` }],
    });
    await expect(database.select().from(productionJobs).where(eq(productionJobs.id, jobId))).resolves.toEqual([]);
    await expect(database.select().from(adminAuditLogs).where(and(
      eq(adminAuditLogs.resourceType, "production_job"),
      eq(adminAuditLogs.resourceId, jobId),
      eq(adminAuditLogs.action, "production_job.deleted"),
    ))).resolves.toHaveLength(1);
  });
});
