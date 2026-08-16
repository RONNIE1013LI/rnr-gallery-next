import { describe, expect, it, vi } from "vitest";
import {
  InvoiceConflictError,
  InvoiceImmutableError,
  InvoiceNotFoundError,
  createInvoiceService,
  type InvoiceRecord,
  type InvoiceRepository,
} from "./invoice-service";

const actor = { userId: "admin-1", email: "ADMIN@EXAMPLE.COM" };
const now = new Date("2026-08-05T01:00:00.000Z");
const record: InvoiceRecord = {
  id: "00000000-0000-4000-8000-000000000010",
  jobId: "00000000-0000-4000-8000-000000000001",
  invoiceNumber: "INV-RRM-2026-ABC123",
  status: "draft",
  invoiceDate: "2026-08-05",
  dueDate: "2026-08-12",
  reference: "RRM-2026-ABC123",
  webOrderNumber: "WEB-1042",
  businessName: "R&R Gallery",
  businessAddress: "Auckland, New Zealand",
  businessEmail: "customerservice@rnrgallery.com",
  businessPhone: "+64 21 023 48948",
  businessWebsite: "https://rnrgallery.com/",
  gstNumber: "GST-TEST",
  bankAccount: "BANK-TEST",
  customerName: "Ana Example",
  customerEmail: "ana@example.com",
  customerAddress: "11 Example Street",
  deliveryAddress: "11 Example Street",
  currency: "NZD",
  gstRateBasisPoints: 1_500,
  pricesIncludeGst: true,
  grossCents: 23_000,
  discountCents: 0,
  subtotalExGstCents: 20_000,
  gstCents: 3_000,
  totalInclGstCents: 23_000,
  notes: "Thank you for your business!",
  terms: "Payment is due within 7 days.",
  issuedAt: null,
  voidedAt: null,
  voidReason: null,
  createdAt: now,
  updatedAt: now,
  items: [{
    position: 0,
    code: "A4",
    description: "Digital Oil Painting Canvas — A4",
    quantityMilli: 1_000,
    rateInclGstCents: 23_000,
    lineTotalInclGstCents: 23_000,
  }],
};

function repository(overrides: Partial<InvoiceRepository> = {}): InvoiceRepository {
  return {
    findByJobId: vi.fn().mockResolvedValue(null),
    getSeed: vi.fn().mockResolvedValue({
      jobNumber: "RRM-2026-ABC123",
      webOrderNumber: "WEB-1042",
      customerName: "Ana Example",
      customerEmail: "ana@example.com",
      customerAddress: "11 Example Street",
      deliveryAddress: "11 Example Street",
      items: [{
        code: "A4",
        description: "Digital Oil Painting Canvas — A4",
        quantityMilli: 1_000,
        rateInclGstCents: 23_000,
      }],
      totals: {
        grossCents: 23_000,
        discountCents: 0,
        subtotalExGstCents: 20_000,
        gstCents: 3_000,
        totalInclGstCents: 23_000,
      },
    }),
    createDraft: vi.fn().mockResolvedValue(record),
    updateDraft: vi.fn().mockResolvedValue({ result: "updated", invoice: record }),
    issue: vi.fn().mockResolvedValue({
      result: "issued",
      invoice: { ...record, status: "issued", issuedAt: now },
    }),
    void: vi.fn().mockResolvedValue({
      result: "voided",
      invoice: { ...record, status: "void", issuedAt: now, voidedAt: now, voidReason: "Duplicate" },
    }),
    findById: vi.fn().mockResolvedValue(record),
    ...overrides,
  };
}

const business = {
  name: "R&R Gallery",
  address: "Auckland, New Zealand",
  email: "customerservice@rnrgallery.com",
  phone: "+64 21 023 48948",
  website: "https://rnrgallery.com/",
  gstNumber: "GST-TEST",
  bankAccount: "BANK-TEST",
};

describe("invoice service", () => {
  it("returns an existing invoice without reseeding it", async () => {
    const repo = repository({ findByJobId: vi.fn().mockResolvedValue(record) });
    const service = createInvoiceService(repo, { business, now: () => now });
    await expect(service.getOrCreateDraft(actor, record.jobId)).resolves.toBe(record);
    expect(repo.getSeed).not.toHaveBeenCalled();
    expect(repo.createDraft).not.toHaveBeenCalled();
  });

  it("seeds and persists a complete audited draft", async () => {
    const repo = repository();
    const service = createInvoiceService(repo, { business, now: () => now });
    await service.getOrCreateDraft(actor, record.jobId);
    expect(repo.createDraft).toHaveBeenCalledWith(expect.objectContaining({
      jobId: record.jobId,
      invoiceNumber: "INV-RRM-2026-ABC123",
      invoiceDate: "2026-08-05",
      dueDate: "2026-08-12",
      businessName: "R&R Gallery",
      customerName: "Ana Example",
      totalInclGstCents: 23_000,
      gstCents: 3_000,
      actor: { userId: "admin-1", email: "admin@example.com" },
      createdAt: now,
    }));
  });

  it("preserves authoritative order tax when shipping carries no GST", async () => {
    const repo = repository({
      getSeed: vi.fn().mockResolvedValue({
        jobNumber: "RNR-2026-AU1234",
        webOrderNumber: "RNR-2026-AU1234",
        customerName: "Ana Example",
        customerEmail: "ana@example.com",
        customerAddress: "1 George Street\nSydney\nNSW\n2000\nAU",
        deliveryAddress: "1 George Street\nSydney\nNSW\n2000\nAU",
        currency: "AUD",
        gstRateBasisPoints: 0,
        items: [
          { code: "A0", description: "Canvas — A0", quantityMilli: 1_000, rateInclGstCents: 36_800 },
          { code: "SHIPPING", description: "Shipping", quantityMilli: 1_000, rateInclGstCents: 4_500 },
        ],
        totals: {
          grossCents: 41_300,
          discountCents: 0,
          subtotalExGstCents: 36_500,
          gstCents: 4_800,
          totalInclGstCents: 41_300,
        },
      }),
    });
    const service = createInvoiceService(repo, { business, now: () => now });

    await service.getOrCreateDraft(actor, record.jobId);

    expect(repo.createDraft).toHaveBeenCalledWith(expect.objectContaining({
      grossCents: 41_300,
      subtotalExGstCents: 36_500,
      gstCents: 4_800,
      totalInclGstCents: 41_300,
      currency: "AUD",
      gstRateBasisPoints: 0,
    }));
  });

  it("updates only a draft using optimistic concurrency", async () => {
    const repo = repository();
    const service = createInvoiceService(repo, { business, now: () => now });
    await service.updateDraft(actor, {
      invoiceId: record.id,
      idempotencyKey: "invoice-update-0001",
      expectedUpdatedAt: "2026-08-05T00:00:00.000Z",
      draft: {
        invoiceDate: "2026-08-05",
        dueDate: "2026-08-12",
        reference: "Updated reference",
        customerName: "Ana Example",
        customerEmail: "ana@example.com",
        customerAddress: "11 Example Street",
        deliveryAddress: "22 Delivery Road",
        discountCents: 2_300,
        notes: "Updated",
        terms: "Due in seven days",
        items: [{
          code: "A4",
          description: "Digital Canvas",
          quantityMilli: 1_000,
          rateInclGstCents: 23_000,
        }],
      },
    });
    expect(repo.updateDraft).toHaveBeenCalledWith(expect.objectContaining({
      expectedUpdatedAt: new Date("2026-08-05T00:00:00.000Z"),
      totalInclGstCents: 20_700,
      gstCents: 2_700,
      actor: { userId: "admin-1", email: "admin@example.com" },
    }));
  });

  it("preserves an imported order tax split when only invoice text changes", async () => {
    const imported = {
      ...record,
      grossCents: 41_300,
      subtotalExGstCents: 36_500,
      gstCents: 4_800,
      totalInclGstCents: 41_300,
      items: [
        { ...record.items[0], code: "A0", rateInclGstCents: 36_800, lineTotalInclGstCents: 36_800 },
        { ...record.items[0], position: 1, code: "SHIPPING", description: "Shipping", rateInclGstCents: 4_500, lineTotalInclGstCents: 4_500 },
      ],
    } satisfies InvoiceRecord;
    const repo = repository({
      findById: vi.fn().mockResolvedValue(imported),
      updateDraft: vi.fn().mockResolvedValue({ result: "updated", invoice: imported }),
    });
    const service = createInvoiceService(repo, { business, now: () => now });

    await service.updateDraft(actor, {
      invoiceId: imported.id,
      idempotencyKey: "invoice-update-tax-split",
      expectedUpdatedAt: imported.updatedAt.toISOString(),
      draft: {
        invoiceDate: imported.invoiceDate,
        dueDate: imported.dueDate,
        reference: "Updated reference only",
        customerName: imported.customerName,
        customerEmail: imported.customerEmail,
        customerAddress: imported.customerAddress,
        deliveryAddress: imported.deliveryAddress,
        discountCents: imported.discountCents,
        notes: imported.notes,
        terms: imported.terms,
        items: imported.items.map((item) => ({
          code: item.code,
          description: item.description,
          quantityMilli: item.quantityMilli,
          rateInclGstCents: item.rateInclGstCents,
        })),
      },
    });

    expect(repo.updateDraft).toHaveBeenCalledWith(expect.objectContaining({
      subtotalExGstCents: 36_500,
      gstCents: 4_800,
      totalInclGstCents: 41_300,
    }));
  });

  it("issues once and rejects edits after issue", async () => {
    const repo = repository({
      updateDraft: vi.fn().mockResolvedValue({ result: "immutable", invoice: null }),
    });
    const service = createInvoiceService(repo, { business, now: () => now });
    await expect(service.issue(actor, {
      invoiceId: record.id,
      idempotencyKey: "invoice-issue-0001",
      expectedUpdatedAt: "2026-08-05T00:00:00.000Z",
    })).resolves.toMatchObject({ status: "issued" });
    await expect(service.updateDraft(actor, {
      invoiceId: record.id,
      idempotencyKey: "invoice-update-0002",
      expectedUpdatedAt: "2026-08-05T00:00:00.000Z",
      draft: {
        invoiceDate: record.invoiceDate,
        dueDate: record.dueDate,
        reference: record.reference,
        customerName: record.customerName,
        customerEmail: record.customerEmail,
        customerAddress: record.customerAddress,
        deliveryAddress: record.deliveryAddress,
        discountCents: 0,
        notes: record.notes,
        terms: record.terms,
        items: record.items.map((item) => ({ code: item.code, description: item.description, quantityMilli: item.quantityMilli, rateInclGstCents: item.rateInclGstCents })),
      },
    })).rejects.toBeInstanceOf(InvoiceImmutableError);
  });

  it("voids an issued invoice only with a reason", async () => {
    const service = createInvoiceService(repository(), { business, now: () => now });
    await expect(service.void(actor, {
      invoiceId: record.id,
      idempotencyKey: "invoice-void-0001",
      expectedUpdatedAt: "2026-08-05T00:00:00.000Z",
      reason: "  Duplicate invoice  ",
    })).resolves.toMatchObject({ status: "void" });
  });

  it.each([
    { result: "conflict", ErrorClass: InvoiceConflictError },
    { result: "not_found", ErrorClass: InvoiceNotFoundError },
    { result: "immutable", ErrorClass: InvoiceImmutableError },
  ] as const)("surfaces $result lifecycle outcomes", async ({ result, ErrorClass }) => {
    const service = createInvoiceService(repository({
      issue: vi.fn().mockResolvedValue({ result, invoice: null }),
    }), { business, now: () => now });
    await expect(service.issue(actor, {
      invoiceId: record.id,
      idempotencyKey: "invoice-issue-outcome",
      expectedUpdatedAt: "2026-08-05T00:00:00.000Z",
    })).rejects.toBeInstanceOf(ErrorClass);
  });

  it("returns a persisted invoice document and rejects missing records", async () => {
    const service = createInvoiceService(repository(), { business, now: () => now });
    await expect(service.getDocument(record.id)).resolves.toBe(record);
    const missing = createInvoiceService(repository({
      findById: vi.fn().mockResolvedValue(null),
    }), { business, now: () => now });
    await expect(missing.getDocument(record.id)).rejects.toBeInstanceOf(InvoiceNotFoundError);
  });
});
