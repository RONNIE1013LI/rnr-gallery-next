import { describe, expect, it, vi } from "vitest";
import {
  ProductionProofConflictError,
  ProductionProofForbiddenError,
  ProductionProofValidationError,
  createProductionProofService,
  deriveRevisionSummary,
  type ProductionProofRepository,
} from "./production-proof-service";

const actor = { userId: "user-1", email: "artist@example.com" };
const jobId = "de31f47e-0fb9-438e-bef6-6bc45556d3bb";
const reference = {
  id: "e23a9f59-bf54-4bb6-a7d0-9239c14cf819",
  originalName: "draft.jpg",
  mimeType: "image/jpeg",
  size: 1024,
  storageKey: "e23a9f59-bf54-4bb6-a7d0-9239c14cf819.bin",
  sha256: "a".repeat(64),
};

function repository(overrides: Partial<ProductionProofRepository> = {}): ProductionProofRepository {
  return {
    findFileByIdempotencyKey: vi.fn().mockResolvedValue(null),
    createFile: vi.fn().mockResolvedValue({ result: "created", file: {
      id: reference.id, jobId: "de31f47e-0fb9-438e-bef6-6bc45556d3bb",
      kind: "design_draft", version: 1, originalName: "draft.jpg",
      mediaType: "image/jpeg", sizeBytes: 1024, createdAt: new Date("2026-08-04T00:00:00Z"),
      review: null,
    } }),
    recordReview: vi.fn().mockResolvedValue({ result: "created", review: {
      id: "0c7fa598-e6b8-46aa-80dd-3ee060126cac",
      fileId: reference.id, decision: "changes_requested", notes: "Move the title.",
      createdAt: new Date("2026-08-04T00:00:00Z"),
    } }),
    listJobFiles: vi.fn().mockResolvedValue([]),
    findPrivateFile: vi.fn().mockResolvedValue(null),
    listCustomerProofs: vi.fn().mockResolvedValue(null),
    findCustomerPrivateFile: vi.fn().mockResolvedValue(null),
    recordCustomerReview: vi.fn().mockResolvedValue({ result: "created", review: {
      id: "0c7fa598-e6b8-46aa-80dd-3ee060126cac",
      fileId: reference.id,
      decision: "approved",
      notes: "",
      reviewerType: "customer",
      createdAt: new Date("2026-08-04T00:00:00Z"),
    } }),
    deletePaymentProof: vi.fn().mockResolvedValue({ result: "deleted", storageKey: reference.storageKey }),
    ...overrides,
  };
}

describe("production proof service", () => {
  it("registers a validated private design draft with a stable request digest", async () => {
    const repo = repository();
    const service = createProductionProofService(repo);
    const result = await service.registerFile(actor, "de31f47e-0fb9-438e-bef6-6bc45556d3bb", {
      kind: "design_draft", idempotencyKey: "upload-request-1", reference,
    }, { canManageFinance: false });

    expect(result.result).toBe("created");
    expect(repo.createFile).toHaveBeenCalledWith(expect.objectContaining({
      jobId: "de31f47e-0fb9-438e-bef6-6bc45556d3bb",
      kind: "design_draft",
      idempotencyKey: "upload-request-1",
      requestDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      actor,
    }));
  });

  it("returns an exact upload retry and rejects reuse with different file metadata", async () => {
    const existing = {
      id: reference.id, jobId: "de31f47e-0fb9-438e-bef6-6bc45556d3bb",
      kind: "design_draft" as const, version: 1, originalName: "draft.jpg",
      mediaType: "image/jpeg", sizeBytes: 1024, createdAt: new Date(), review: null,
      requestDigest: "",
    };
    const firstRepo = repository();
    const service = createProductionProofService(firstRepo);
    await service.registerFile(actor, existing.jobId, {
      kind: "design_draft", idempotencyKey: "upload-request-1", reference,
    }, { canManageFinance: false });
    const digest = vi.mocked(firstRepo.createFile).mock.calls[0][0].requestDigest;

    const duplicateRepo = repository({ findFileByIdempotencyKey: vi.fn().mockResolvedValue({ ...existing, requestDigest: digest }) });
    await expect(createProductionProofService(duplicateRepo).registerFile(actor, existing.jobId, {
      kind: "design_draft", idempotencyKey: "upload-request-1", reference: {
        ...reference,
        id: "398d3e68-2cce-44bf-9d45-b4d09b8d8c71",
        storageKey: "398d3e68-2cce-44bf-9d45-b4d09b8d8c71.bin",
      },
    }, { canManageFinance: false })).resolves.toMatchObject({ result: "duplicate" });

    await expect(createProductionProofService(duplicateRepo).registerFile(actor, existing.jobId, {
      kind: "design_draft", idempotencyKey: "upload-request-1",
      reference: { ...reference, sha256: "b".repeat(64) },
    }, { canManageFinance: false })).rejects.toBeInstanceOf(ProductionProofConflictError);
  });

  it("keeps payment proof uploads behind finance permission", async () => {
    const service = createProductionProofService(repository());
    await expect(service.registerFile(actor, jobId, {
      kind: "payment_proof", idempotencyKey: "payment-proof-1", reference,
    }, { canManageFinance: false })).rejects.toBeInstanceOf(ProductionProofForbiddenError);
  });

  it("deletes only a job-owned payment proof through the repository boundary", async () => {
    const repo = repository();
    const service = createProductionProofService(repo);

    await expect(service.deletePaymentProof(actor, jobId, reference.id, {
      canDeleteFiles: false,
    })).rejects.toBeInstanceOf(ProductionProofForbiddenError);

    await expect(service.deletePaymentProof(actor, jobId, reference.id, {
      canDeleteFiles: true,
    })).resolves.toEqual({ result: "deleted", storageKey: reference.storageKey });
    expect(repo.deletePaymentProof).toHaveBeenCalledWith(expect.objectContaining({
      actor,
      jobId,
      fileId: reference.id,
    }));
  });

  it("does not let finance permission substitute for payment-proof access", async () => {
    const repo = repository({
      findPrivateFile: vi.fn().mockResolvedValue({
        id: reference.id,
        jobId,
        kind: "payment_proof",
        version: null,
        originalName: "bank-receipt.jpg",
        mediaType: "image/jpeg",
        sizeBytes: reference.size,
        createdAt: new Date("2026-08-18T00:00:00Z"),
        review: null,
        storageKey: reference.storageKey,
      }),
    });

    await expect(createProductionProofService(repo).getPrivateFile(jobId, reference.id, {
      canViewFinance: true,
      canViewPaymentProof: false,
    })).rejects.toMatchObject({
      name: "ProductionProofForbiddenError",
      message: "Payment-proof permission is required",
    });
  });

  it("accepts PDF metadata only for finance-authorised payment proofs", async () => {
    const service = createProductionProofService(repository());
    const pdfReference = {
      ...reference,
      originalName: "bank-receipt.pdf",
      mimeType: "application/pdf",
    };

    await expect(service.registerFile(actor, jobId, {
      kind: "payment_proof",
      idempotencyKey: "payment-proof-pdf-1",
      reference: pdfReference,
    }, { canManageFinance: true })).resolves.toMatchObject({ result: "created" });

    await expect(service.registerFile(actor, jobId, {
      kind: "customer_file",
      idempotencyKey: "customer-file-pdf-1",
      reference: pdfReference,
    }, { canManageFinance: true })).rejects.toBeInstanceOf(ProductionProofValidationError);
  });

  it("records only valid immutable proof decisions", async () => {
    const repo = repository();
    const service = createProductionProofService(repo);
    await service.recordReview(actor, "de31f47e-0fb9-438e-bef6-6bc45556d3bb", {
      fileId: reference.id, decision: "changes_requested", notes: "Move the title.",
      idempotencyKey: "proof-review-1",
    });
    expect(repo.recordReview).toHaveBeenCalledWith(expect.objectContaining({
      actor, decision: "changes_requested", notes: "Move the title.",
    }));
    await expect(service.recordReview(actor, "bad", {})).rejects.toBeInstanceOf(ProductionProofValidationError);
  });

  it("derives free revisions from actual change requests without altering prices", () => {
    expect(deriveRevisionSummary([{ decision: "changes_requested" }, { decision: "approved" }])).toEqual({
      changesRequested: 1, freeRevisionsRemaining: 1, requiresAdditionalChargeReview: false,
    });
    expect(deriveRevisionSummary([
      { decision: "changes_requested" }, { decision: "changes_requested" }, { decision: "changes_requested" },
    ])).toEqual({ changesRequested: 3, freeRevisionsRemaining: 0, requiresAdditionalChargeReview: true });
  });

  it("accepts a customer decision only through validated order access", async () => {
    const repo = repository();
    const service = createProductionProofService(repo);
    const access = { kind: "customer" as const, userId: "customer-1" };

    await service.recordCustomerReview("RNR-2026-ABC123", access, {
      fileId: reference.id,
      decision: "approved",
      notes: "ignored approval note",
      idempotencyKey: "customer-review-1",
    });

    expect(repo.recordCustomerReview).toHaveBeenCalledWith(expect.objectContaining({
      orderNumber: "RNR-2026-ABC123",
      access,
      decision: "approved",
      notes: "",
    }));
  });

  it("requires one consolidated note when the customer requests changes", async () => {
    const service = createProductionProofService(repository());

    await expect(service.recordCustomerReview(
      "RNR-2026-ABC123",
      { kind: "checkout", tokenDigest: "a".repeat(64) },
      {
        fileId: reference.id,
        decision: "changes_requested",
        notes: "",
        idempotencyKey: "customer-review-1",
      },
    )).rejects.toBeInstanceOf(ProductionProofValidationError);
  });

  it("returns customer-safe proof history and revision totals", async () => {
    const files = [{
      id: reference.id,
      version: 1,
      originalName: reference.originalName,
      mediaType: reference.mimeType,
      sizeBytes: reference.size,
      createdAt: new Date("2026-08-04T00:00:00Z"),
      review: null,
    }];
    const repo = repository({
      listCustomerProofs: vi.fn().mockResolvedValue({
        orderNumber: "RNR-2026-ABC123",
        fulfilmentStatus: "awaiting_customer",
        files,
      }),
    });

    await expect(createProductionProofService(repo).listCustomerProofs(
      "RNR-2026-ABC123",
      { kind: "signed", fileId: reference.id },
    )).resolves.toMatchObject({
      orderNumber: "RNR-2026-ABC123",
      fulfilmentStatus: "awaiting_customer",
      files,
      revision: { changesRequested: 0, freeRevisionsRemaining: 2 },
    });
  });
});
