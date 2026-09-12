import { PDFDocument } from "pdf-lib";
import { deliverNewOrderInvoiceEmail, getAdminInvoiceRuntime } from "@/server/admin/admin-invoice-runtime";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { adminAuditLogs, invoices, productionJobs, user } from "@/server/db/schema";
import { createDrizzleProductionJobRepository } from "@/server/production/drizzle-production-job-repository";
import { createProductionJobService } from "@/server/production/production-job-service";
import { createDrizzleInvoiceRepository } from "./drizzle-invoice-repository";
import { createInvoiceService, InvoiceImmutableError } from "./invoice-service";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");

const pool = new Pool({ connectionString: databaseUrl });
const database = drizzle(pool);
const suffix = randomUUID();
const actorId = `invoice-actor-${suffix}`;
const jobIds: string[] = [];
const invoiceIds: string[] = [];
const actor = { userId: actorId, email: `invoice-${suffix}@example.test` };
const business = {
  name: "R&R Gallery",
  address: "Auckland, New Zealand",
  email: "customerservice@rnrgallery.com",
  phone: "+64 21 023 48948",
  website: "https://rnrgallery.com/",
  gstNumber: "GST-TEST",
  bankAccount: "BANK-TEST",
};

describe("drizzle invoice repository", () => {
  beforeAll(async () => {
    await database.insert(user).values({
      id: actorId,
      name: "Invoice Manager",
      email: actor.email,
      role: "admin",
    });
  });

  afterAll(async () => {
    if (invoiceIds.length) await database.delete(invoices).where(inArray(invoices.id, invoiceIds));
    if (jobIds.length) await database.delete(productionJobs).where(inArray(productionJobs.id, jobIds));
    await database.delete(adminAuditLogs).where(and(
      eq(adminAuditLogs.actorUserId, actorId),
      inArray(adminAuditLogs.resourceType, ["production_job", "invoice"]),
    ));
    await database.delete(user).where(eq(user.id, actorId));
    await pool.end();
  });

  it("persists, edits, issues and voids a manual-job invoice with audit history", async () => {
    const job = await createProductionJobService(
      createDrizzleProductionJobRepository(database),
      {
        createJobNumber: () => `RRM-2026-${suffix.slice(0, 10).toUpperCase()}`,
        now: () => new Date("2026-08-05T00:00:00.000Z"),
      },
    ).createManual(actor, {
      idempotencyKey: `invoice-job-${suffix}`,
      customerName: "Invoice Customer",
      customerEmail: "customer@example.test",
      customerPhone: "021 111 2222",
      customerSource: "rnr",
      webOrderNumber: "WEB-TEST-42",
      urgent: false,
      neededDate: "2026-08-20",
      deliveryMethod: "courier",
      deliveryAddress: "11 Test Road\nAuckland 0632",
      paymentReconciliationStatus: "Arrive",
      assignedUserId: null,
      designRequirements: "Blue background",
      internalNotes: "Invoice integration test",
      manualStatus: "new",
      manualPaymentStatus: "processing",
      amountPayableCents: 23_000,
      amountPaidCents: 10_000,
      artistFeeCents: 4_000,
      materialCostCents: 2_000,
      artistPaid: false,
      completed: false,
      items: [{
        productTitle: "Digital Oil Painting Canvas",
        sizeLabel: "A4",
        quantity: 1,
        designText: "",
        notes: "",
      }],
    }, { canUpdateFinance: true });
    jobIds.push(job.job.id);

    const repository = createDrizzleInvoiceRepository(database);
    const service = createInvoiceService(repository, {
      business,
      now: () => new Date("2026-08-05T01:00:00.000Z"),
    });
    const draft = await service.getOrCreateDraft(actor, job.job.id);
    invoiceIds.push(draft.id);
    expect(draft).toMatchObject({
      status: "draft",
      webOrderNumber: "WEB-TEST-42",
      deliveryAddress: "11 Test Road\nAuckland 0632",
      totalInclGstCents: 23_000,
      subtotalExGstCents: 20_000,
      gstCents: 3_000,
    });

    const updated = await service.updateDraft(actor, {
      invoiceId: draft.id,
      idempotencyKey: `invoice-update-${suffix}`,
      expectedUpdatedAt: draft.updatedAt.toISOString(),
      draft: {
        invoiceDate: draft.invoiceDate,
        dueDate: draft.dueDate,
        reference: draft.reference,
        customerName: draft.customerName,
        customerEmail: draft.customerEmail,
        customerAddress: draft.customerAddress,
        deliveryAddress: draft.deliveryAddress,
        discountCents: 2_300,
        notes: "Discount approved",
        terms: draft.terms,
        items: draft.items.map((item) => ({ code: item.code, description: item.description, quantityMilli: item.quantityMilli, rateInclGstCents: item.rateInclGstCents })),
      },
    });
    expect(updated).toMatchObject({ totalInclGstCents: 20_700, gstCents: 2_700 });

    const issued = await createInvoiceService(repository, {
      business,
      now: () => new Date("2026-08-05T02:00:00.000Z"),
    }).issue(actor, {
      invoiceId: updated.id,
      idempotencyKey: `invoice-issue-${suffix}`,
      expectedUpdatedAt: updated.updatedAt.toISOString(),
    });
    expect(issued.status).toBe("issued");

    await expect(service.updateDraft(actor, {
      invoiceId: issued.id,
      idempotencyKey: `invoice-late-update-${suffix}`,
      expectedUpdatedAt: issued.updatedAt.toISOString(),
      draft: {
        invoiceDate: issued.invoiceDate,
        dueDate: issued.dueDate,
        reference: issued.reference,
        customerName: issued.customerName,
        customerEmail: issued.customerEmail,
        customerAddress: issued.customerAddress,
        deliveryAddress: issued.deliveryAddress,
        discountCents: issued.discountCents,
        notes: "Should not save",
        terms: issued.terms,
        items: issued.items.map((item) => ({ code: item.code, description: item.description, quantityMilli: item.quantityMilli, rateInclGstCents: item.rateInclGstCents })),
      },
    })).rejects.toBeInstanceOf(InvoiceImmutableError);

    const voided = await createInvoiceService(repository, {
      business,
      now: () => new Date("2026-08-05T03:00:00.000Z"),
    }).void(actor, {
      invoiceId: issued.id,
      idempotencyKey: `invoice-void-${suffix}`,
      expectedUpdatedAt: issued.updatedAt.toISOString(),
      reason: "Duplicate invoice",
    });
    expect(voided).toMatchObject({ status: "void", voidReason: "Duplicate invoice" });

    const invoiceAudits = await database.select().from(adminAuditLogs).where(and(
      eq(adminAuditLogs.resourceId, voided.id),
      eq(adminAuditLogs.resourceType, "invoice"),
    ));
    expect(invoiceAudits.map((entry) => entry.action).sort()).toEqual([
      "invoice.created",
      "invoice.issued",
      "invoice.updated",
      "invoice.voided",
    ]);
  });


describe("automatic manual invoice committed delivery", () => {
  it.each(["valid", "missing", "provider_failure", "without_preview"])("handles %s and retains manual recovery", async (scenario) => {
    const email = scenario === "missing" ? "" : "persisted@example.test";
    const scheduled: string[] = [];
    const provider = { configured: true, send: vi.fn().mockResolvedValue({ providerMessageId: "auto-test-mail" }) };
    if (scenario === "provider_failure") provider.send.mockRejectedValueOnce(new Error("unavailable"));
    const create = createProductionJobService(createDrizzleProductionJobRepository(database, { onNewInvoiceOrder: (id) => { scheduled.push(id); } }), { createJobNumber: () => `AUTO-${randomUUID()}` });
    const input = {
      idempotencyKey: `auto-${randomUUID()}`,
      customerName: "Invoice Customer",
      customerEmail: email,
      customerPhone: "021 111 2222",
      customerSource: "rnr",
      webOrderNumber: "",
      urgent: false,
      neededDate: "2026-08-20",
      deliveryMethod: "courier",
      deliveryAddress: "11 Test Road\nAuckland 0632",
      paymentReconciliationStatus: "Arrive",
      assignedUserId: null,
      designRequirements: "Blue background",
      internalNotes: "Invoice integration test",
      manualStatus: "new",
      manualPaymentStatus: "processing",
      amountPayableCents: 23_000,
      amountPaidCents: 10_000,
      artistFeeCents: 4_000,
      materialCostCents: 2_000,
      artistPaid: false,
      completed: false,
      items: [{
        productTitle: "Digital Oil Painting Canvas",
        sizeLabel: "A4",
        quantity: 1,
        designText: "",
        notes: "",
      }],

      invoiceDraft: { invoiceDate: "2026-09-13", dueDate: "2026-09-20", reference: "DRAFT", customerName: "Test", customerEmail: "invoice-snapshot@example.test", customerAddress: "Test address", deliveryAddress: "Test address", discountCents: 0, notes: "Test", terms: "Test", items: [{ code: "TEST", description: "Test Canvas", quantityMilli: 1000, rateInclGstCents: 23000 }] },
    };
    if (scenario === "without_preview") delete (input as Partial<typeof input>).invoiceDraft;
    const result = await create.createManual(actor, input, { canUpdateFinance: true });
    jobIds.push(result.job.id);
    const doc = await createDrizzleInvoiceRepository(database).findByJobId(result.job.id);
    expect(doc).not.toBeNull();
    invoiceIds.push(doc!.id);
    expect(scheduled).toEqual([result.job.id]);
    await Promise.all([deliverNewOrderInvoiceEmail(result.job.id, database, provider), deliverNewOrderInvoiceEmail(result.job.id, database, provider)]);
    await create.createManual(actor, input, { canUpdateFinance: true });
    expect(scheduled).toHaveLength(1);
    expect(provider.send).toHaveBeenCalledTimes(scenario === "missing" ? 0 : 1);
    const history = await database.select().from(adminAuditLogs).where(eq(adminAuditLogs.resourceId, doc!.id));
    expect(history).toEqual(expect.arrayContaining([expect.objectContaining({ afterSummary: expect.objectContaining({ source: "automatic", trigger: "manual_order_created" }) })]));
    if (scenario === "missing") expect(history.some(x => x.action === "invoice.email.skipped")).toBe(true);
    if (scenario === "provider_failure") expect(history.some(x => x.result === "failure")).toBe(true);
    const runtime = getAdminInvoiceRuntime(database, provider);
    expect(Boolean(await runtime.latestEmailAttempt(doc!.id))).toBe((scenario === "valid" || scenario === "without_preview"));
    if ((scenario === "valid" || scenario === "without_preview")) {
      const message = provider.send.mock.calls[0][0];
      expect(message.to).toBe(email);
      expect(message.text).not.toContain("/orders/");
      expect(message.html.match(/Kind regards/g)).toHaveLength(1);
      expect((await PDFDocument.load(message.attachments[0].content)).getPageCount()).toBeGreaterThan(0);
    }
    await runtime.createEmailService(actor, { source: "manual", trigger: "manual_resend" }).send(doc!, { recipientEmail: "alternate@example.test", idempotencyKey: `resend-${randomUUID()}` });
    expect(provider.send).toHaveBeenCalledTimes(scenario === "missing" ? 1 : 2);
    const finalHistory = await database.select().from(adminAuditLogs).where(eq(adminAuditLogs.resourceId, doc!.id));
    expect(finalHistory).toEqual(expect.arrayContaining([expect.objectContaining({ result: "success", afterSummary: expect.objectContaining({ source: "manual", trigger: "manual_resend" }) })]));
  });
});

});
