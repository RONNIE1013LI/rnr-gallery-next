import { describe, expect, it, vi } from "vitest";
import {
  ProductionJobConflictError,
  ProductionJobValidationError,
  createManualJobNumber,
  createProductionJobService,
  deriveManualJobFinance,
  parseProductionJobFilters,
  type ProductionJobRepository,
} from "./production-job-service";

const actor = { userId: "staff-1", email: "STAFF@EXAMPLE.COM" };
const validInput = {
  idempotencyKey: "manual-request-0001",
  customerName: "  Ana Example  ",
  customerEmail: " ANA@EXAMPLE.COM ",
  customerPhone: "021 123 4567",
  customerSource: "messenger",
  webOrderNumber: "WEB-1042",
  urgent: true,
  neededDate: "2026-08-12",
  deliveryMethod: "post",
  deliveryAddress: "11 Example Street\nAuckland 0632",
  paymentReconciliationStatus: "Arrive",
  assignedUserId: "artist-1",
  designRequirements: "  Use the blue background. ",
  internalNotes: " Deposit received ",
  manualStatus: "new",
  manualPaymentStatus: "processing",
  amountPayableCents: 23_000,
  amountPaidCents: 10_000,
  artistFeeCents: 4_000,
  materialCostCents: 2_500,
  artistPaid: true,
  fileSent: true,
  downloaded: true,
  printed: false,
  customerNotified: true,
  delivered: false,
  completed: false,
  items: [{
    productTitle: " Roll-Up Banner ",
    sizeLabel: " 85 × 200 cm ",
    quantity: 1,
    designText: "HAPPY BIRTHDAY",
    notes: "Use photo one",
  }],
} as const;

function repository(overrides: Partial<ProductionJobRepository> = {}): ProductionJobRepository {
  return {
    findManualByIdempotencyKey: vi.fn().mockResolvedValue(null),
    createManual: vi.fn().mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000001",
      jobNumber: "RRM-2026-TEST000001",
      requestDigest: "created-digest",
      updatedAt: new Date("2026-08-04T10:00:00.000Z"),
    }),
    update: vi.fn().mockResolvedValue("updated"),
    deleteManual: vi.fn().mockResolvedValue({ result: "deleted", jobNumber: "08000", files: [] }),
    ...overrides,
  };
}

describe("production job filters", () => {
  it("normalizes supported filters and rejects untrusted enum values", () => {
    expect(parseProductionJobFilters({
      q: "  Ana  ",
      source: "manual",
      status: "designing",
      urgent: "yes",
      assigned: "staff-1",
      from: "2026-08-01",
      to: "bad-date",
      page: "2",
      pageSize: "500",
    })).toEqual({
      query: "Ana",
      source: "manual",
      status: "designing",
      urgent: true,
      assignedUserId: "staff-1",
      from: "2026-08-01",
      page: 2,
      pageSize: 100,
      sort: "created",
      direction: "desc",
    });
  });
});

describe("production job payment reconciliation", () => {
  it("rejects Zip as a new manual reconciliation status", async () => {
    const service = createProductionJobService(repository());

    await expect(service.createManual(actor, {
      ...validInput,
      paymentReconciliationStatus: "ZIP PAY",
    }, { canUpdateFinance: true })).rejects.toBeInstanceOf(ProductionJobValidationError);

    await expect(service.update(actor, {
      jobId: "00000000-0000-4000-8000-000000000001",
      idempotencyKey: "reject-zip-payment-status",
      expectedUpdatedAt: "2026-08-04T10:00:00.000Z",
      paymentReconciliationStatus: "ZIP PAY",
    }, { canUpdateFinance: true })).rejects.toBeInstanceOf(ProductionJobValidationError);
  });
});

describe("manual production finance", () => {
  it("derives owing and actual profit without storing a second formula", () => {
    expect(deriveManualJobFinance({
      amountPayableCents: 23_000,
      amountPaidCents: 10_000,
      artistFeeCents: 4_000,
      materialCostCents: 2_500,
    })).toEqual({ amountOwingCents: 13_000, actualProfitCents: 3_500 });
  });
});

describe("manual production job service", () => {
  it("creates a normalized audited persistence request", async () => {
    const repo = repository();
    const service = createProductionJobService(repo, {
      createJobNumber: () => "RRM-2026-TEST000001",
      now: () => new Date("2026-08-04T10:00:00.000Z"),
    });

    const result = await service.createManual(actor, validInput, { canUpdateFinance: true });

    expect(result.result).toBe("created");
    expect(repo.createManual).toHaveBeenCalledWith(expect.objectContaining({
      jobNumber: "RRM-2026-TEST000001",
      customerName: "Ana Example",
      customerEmail: "ana@example.com",
      webOrderNumber: "WEB-1042",
      deliveryAddress: "11 Example Street\nAuckland 0632",
      paymentReconciliationStatus: "Arrive",
      artistPaidAt: new Date("2026-08-04T10:00:00.000Z"),
      fileSentAt: new Date("2026-08-04T10:00:00.000Z"),
      downloadedAt: new Date("2026-08-04T10:00:00.000Z"),
      printedAt: null,
      customerNotifiedAt: new Date("2026-08-04T10:00:00.000Z"),
      deliveredAt: null,
      completedAt: null,
      designRequirements: "Use the blue background.",
      internalNotes: "Deposit received",
      actor: { userId: "staff-1", email: "staff@example.com" },
      createdAt: new Date("2026-08-04T10:00:00.000Z"),
      items: [expect.objectContaining({
        position: 0,
        productTitle: "Roll-Up Banner",
        sizeLabel: "85 × 200 cm",
      })],
    }));
    expect(result.job.jobNumber).toBe("RRM-2026-TEST000001");
    expect(result.job.updatedAt).toEqual(new Date("2026-08-04T10:00:00.000Z"));
  });

  it("preserves R&R and WeChat sources and staff-only legacy delivery choices", async () => {
    const service = createProductionJobService(repository());
    await expect(service.createManual(actor, {
      ...validInput,
      customerSource: "rnr",
      deliveryMethod: "australia_shipping",
    }, { canUpdateFinance: true })).resolves.toMatchObject({ result: "created" });
    await expect(service.createManual(actor, {
      ...validInput,
      idempotencyKey: "manual-request-0002",
      customerSource: "wechat",
      deliveryMethod: "courier",
    }, { canUpdateFinance: true })).resolves.toMatchObject({ result: "created" });
  });

  it("returns an idempotent duplicate only when the normalized payload matches", async () => {
    const firstRepo = repository();
    const service = createProductionJobService(firstRepo, {
      createJobNumber: () => "RRM-2026-TEST000001",
    });
    await service.createManual(actor, validInput, { canUpdateFinance: true });
    const firstCall = vi.mocked(firstRepo.createManual).mock.calls[0][0];

    const duplicateRepo = repository({
      findManualByIdempotencyKey: vi.fn().mockResolvedValue({
        id: "00000000-0000-4000-8000-000000000001",
        jobNumber: "RRM-2026-TEST000001",
        requestDigest: firstCall.requestDigest,
        updatedAt: new Date("2026-08-04T10:00:00.000Z"),
      }),
    });
    const duplicateService = createProductionJobService(duplicateRepo);

    await expect(duplicateService.createManual(actor, validInput, { canUpdateFinance: true })).resolves.toEqual({
      result: "duplicate",
      job: {
        id: "00000000-0000-4000-8000-000000000001",
        jobNumber: "RRM-2026-TEST000001",
        requestDigest: firstCall.requestDigest,
        updatedAt: new Date("2026-08-04T10:00:00.000Z"),
      },
    });
    expect(duplicateRepo.createManual).not.toHaveBeenCalled();
  });

  it("rejects reuse of an idempotency key with different job data", async () => {
    const repo = repository({
      findManualByIdempotencyKey: vi.fn().mockResolvedValue({
        id: "00000000-0000-4000-8000-000000000001",
        jobNumber: "RRM-2026-TEST000001",
        requestDigest: "different",
        updatedAt: new Date("2026-08-04T10:00:00.000Z"),
      }),
    });
    const service = createProductionJobService(repo);

    await expect(service.createManual(actor, validInput, { canUpdateFinance: true })).rejects.toBeInstanceOf(
      ProductionJobConflictError,
    );
  });

  it("rejects impossible dates, missing contact methods and overpayment", async () => {
    const service = createProductionJobService(repository());
    for (const input of [
      { ...validInput, neededDate: "2026-02-31" },
      { ...validInput, customerEmail: "", customerPhone: "" },
      { ...validInput, amountPaidCents: 23_001 },
    ]) {
      await expect(service.createManual(actor, input, { canUpdateFinance: true })).rejects.toBeInstanceOf(
        ProductionJobValidationError,
      );
    }
  });

  it("generates a manual reference in the Auckland calendar year", () => {
    expect(createManualJobNumber(
      new Date("2025-12-31T11:30:00.000Z"),
      () => "ABCDEF1234",
    )).toBe("RRM-2026-ABCDEF1234");
  });

  it("uses the shared async numeric allocator for manual orders", async () => {
    const repo = repository();
    const service = createProductionJobService(repo, {
      createJobNumber: vi.fn().mockResolvedValue("08000"),
    });
    await service.createManual(actor, validInput, { canUpdateFinance: true });
    expect(repo.createManual).toHaveBeenCalledWith(expect.objectContaining({
      jobNumber: "08000",
    }));
  });

  it("validates and prepares an invoice draft for the same manual-job transaction", async () => {
    const repo = repository();
    const service = createProductionJobService(repo, { createJobNumber: () => "08000" });
    await service.createManual(actor, {
      ...validInput,
      invoiceDraft: {
        invoiceDate: "2026-08-16", dueDate: "2026-08-23", reference: "DRAFT",
        businessName: "R&R Gallery", businessAddress: "11 Para Close", businessEmail: "customerservice@rnrgallery.com",
        businessPhone: "+64 21 023 48948", businessWebsite: "https://rnrgallery.com/", gstNumber: "125-796-389", bankAccount: "04-2021-0317735-07",
        customerName: "Ana Example", customerEmail: "ana@example.com", customerAddress: "11 Example Street", deliveryAddress: "11 Example Street",
        discountCents: 0, notes: "Thanks", terms: "Seven days", items: [{ code: "PRD", description: "Canvas", quantityMilli: 1_000, rateInclGstCents: 23_000 }],
      },
    }, { canUpdateFinance: true });
    expect(repo.createManual).toHaveBeenCalledWith(expect.objectContaining({
      jobNumber: "08000",
      invoice: expect.objectContaining({ invoiceNumber: "INV-08000", reference: "08000", totalInclGstCents: 23_000, gstCents: 3_000 }),
    }));
  });

  it("requires finance permission for a pre-save invoice draft", async () => {
    const service = createProductionJobService(repository());
    await expect(service.createManual(actor, {
      ...validInput,
      manualPaymentStatus: "awaiting_payment", amountPayableCents: 0, amountPaidCents: 0,
      artistFeeCents: 0, materialCostCents: 0, paymentReconciliationStatus: "Not checked", artistPaid: false,
      invoiceDraft: {},
    }, { canUpdateFinance: false })).rejects.toThrow("Finance permission is required");
  });

  it("prevents staff without finance permission from entering payment or costs", async () => {
    const service = createProductionJobService(repository());
    await expect(service.createManual(actor, validInput, {
      canUpdateFinance: false,
    })).rejects.toBeInstanceOf(ProductionJobValidationError);

    await expect(service.createManual(actor, {
      ...validInput,
      manualPaymentStatus: "awaiting_payment",
      amountPayableCents: 0,
      amountPaidCents: 0,
      artistFeeCents: 0,
      materialCostCents: 0,
      paymentReconciliationStatus: "Not checked",
      artistPaid: false,
    }, { canUpdateFinance: false })).resolves.toMatchObject({ result: "created" });
  });

  it("normalizes operational updates and timestamps completed milestones", async () => {
    const repo = repository();
    const service = createProductionJobService(repo, {
      now: () => new Date("2026-08-04T11:00:00.000Z"),
    });
    const result = await service.update(actor, {
      jobId: "00000000-0000-4000-8000-000000000001",
      idempotencyKey: "update-request-0001",
      expectedUpdatedAt: "2026-08-04T10:00:00.000Z",
      assignedUserId: " artist-2 ",
      urgent: false,
      neededDate: "2026-08-15",
      deliveryMethod: "pickup",
      deliveryAddress: "22 Updated Road\nWellington 6011",
      paymentReconciliationStatus: "Checked2",
      designRequirements: " Updated design ",
      internalNotes: " Updated note ",
      manualStatus: "designing",
      milestones: {
        fileSent: true,
        downloaded: false,
        printed: false,
        customerNotified: false,
        delivered: false,
        artistPaid: true,
        completed: true,
      },
    }, { canUpdateFinance: true });

    expect(result).toBe("updated");
    expect(repo.update).toHaveBeenCalledWith(expect.objectContaining({
      actor: { userId: "staff-1", email: "staff@example.com" },
      assignedUserId: "artist-2",
      designRequirements: "Updated design",
      internalNotes: "Updated note",
      deliveryAddress: "22 Updated Road\nWellington 6011",
      paymentReconciliationStatus: "Checked2",
      expectedUpdatedAt: new Date("2026-08-04T10:00:00.000Z"),
      updatedAt: new Date("2026-08-04T11:00:00.000Z"),
      fileSentAt: new Date("2026-08-04T11:00:00.000Z"),
      downloadedAt: null,
      artistPaidAt: new Date("2026-08-04T11:00:00.000Z"),
      completedAt: new Date("2026-08-04T11:00:00.000Z"),
    }));
  });

  it("updates the source-parity customer source field", async () => {
    const repo = repository();
    const service = createProductionJobService(repo);
    await service.update(actor, {
      jobId: "00000000-0000-4000-8000-000000000001",
      idempotencyKey: "update-customer-source",
      expectedUpdatedAt: "2026-08-04T10:00:00.000Z",
      customerSource: "instagram",
    }, { canUpdateFinance: false });
    expect(repo.update).toHaveBeenCalledWith(expect.objectContaining({
      customerSource: "instagram",
    }));
  });

  it("accepts a complete saved manual-entry edit for customer and item fields", async () => {
    const repo = repository();
    const service = createProductionJobService(repo);
    await service.update(actor, {
      jobId: "00000000-0000-4000-8000-000000000001",
      idempotencyKey: "update-complete-manual-entry",
      expectedUpdatedAt: "2026-08-04T10:00:00.000Z",
      customerName: " Updated Customer ",
      customerEmail: " UPDATED@EXAMPLE.TEST ",
      customerPhone: " +64 21 000 0000 ",
      items: [{ productTitle: " Canvas ", sizeLabel: " A1 ", quantity: 1, designText: "", notes: "" }],
    }, { canUpdateFinance: false });

    expect(repo.update).toHaveBeenCalledWith(expect.objectContaining({
      customerName: "Updated Customer",
      customerEmail: "updated@example.test",
      customerPhone: "+64 21 000 0000",
      items: [{ productTitle: "Canvas", sizeLabel: "A1", quantity: 1, designText: "", notes: "" }],
    }));
  });

  it("rejects a saved manual-entry edit that removes both customer contact methods", async () => {
    const service = createProductionJobService(repository());
    await expect(service.update(actor, {
      jobId: "00000000-0000-4000-8000-000000000001",
      idempotencyKey: "update-empty-contact",
      expectedUpdatedAt: "2026-08-04T10:00:00.000Z",
      customerName: "Customer",
      customerEmail: "",
      customerPhone: "",
    }, { canUpdateFinance: false })).rejects.toThrow(ProductionJobValidationError);
  });

  it("requires finance permission before accepting manual payment or cost fields", async () => {
    const service = createProductionJobService(repository());
    await expect(service.update(actor, {
      jobId: "00000000-0000-4000-8000-000000000001",
      idempotencyKey: "update-request-0002",
      expectedUpdatedAt: "2026-08-04T10:00:00.000Z",
      finance: {
        manualPaymentStatus: "paid",
        amountPayableCents: 20_000,
        amountPaidCents: 20_000,
        artistFeeCents: 4_000,
        materialCostCents: 2_000,
      },
    }, { canUpdateFinance: false })).rejects.toBeInstanceOf(
      ProductionJobValidationError,
    );
  });

  it("requires finance permission for reconciliation and artist-paid updates", async () => {
    const service = createProductionJobService(repository());
    for (const update of [
      { paymentReconciliationStatus: "Checked2" },
      { milestones: { artistPaid: true } },
    ]) {
      await expect(service.update(actor, {
        jobId: "00000000-0000-4000-8000-000000000001",
        idempotencyKey: "update-request-finance-only",
        expectedUpdatedAt: "2026-08-04T10:00:00.000Z",
        ...update,
      }, { canUpdateFinance: false })).rejects.toBeInstanceOf(
        ProductionJobValidationError,
      );
    }
  });

  it("surfaces optimistic update conflicts instead of overwriting newer work", async () => {
    const service = createProductionJobService(repository({
      update: vi.fn().mockResolvedValue("conflict"),
    }));
    await expect(service.update(actor, {
      jobId: "00000000-0000-4000-8000-000000000001",
      idempotencyKey: "update-request-0003",
      expectedUpdatedAt: "2026-08-04T10:00:00.000Z",
      urgent: true,
    }, { canUpdateFinance: false })).rejects.toBeInstanceOf(
      ProductionJobConflictError,
    );
  });
});
