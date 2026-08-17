import { describe, expect, it, vi } from "vitest";
import type { CustomerServiceRepository } from "../repositories/customer-service-repository";
import { createAttachmentProcessor } from "./attachment-processor";

const storageKey = "customer-service-attachments/00000000-0000-4000-8000-000000000001.bin";
const analysis = {
  schemaVersion: "1" as const,
  overallStatus: "assessed" as const,
  images: [{
    ordinal: 0,
    classification: "customer_photo" as const,
    blur: "mild" as const,
    sourceResolutionSignal: "normal" as const,
    subjectScale: "large" as const,
    crop: "none_visible" as const,
    obstruction: "none_visible" as const,
    screenshotSignal: "none_visible" as const,
    recommendedRole: "main_candidate" as const,
    issueCodes: [],
  }],
  comparison: null,
  recommendationCodes: ["use_as_main_candidate" as const],
  safeSummary: "Image 0 is the likely main candidate.",
};

function setup() {
  const repositoryMethods = {
    createImageAnalysisAttempt: vi.fn(async () => "image-attempt-1"),
    markImageAttachmentStored: vi.fn(async () => undefined),
    reserveImageAnalysisAttempt: vi.fn<CustomerServiceRepository["reserveImageAnalysisAttempt"]>(async () => ({ status: "reserved" as const })),
    completeImageAnalysisAttempt: vi.fn(async () => undefined),
    markImageAttachmentDeleted: vi.fn(async () => undefined),
  };
  const repository = repositoryMethods as typeof repositoryMethods & CustomerServiceRepository;
  const sourceReader = {
    channel: "facebook" as const,
    read: vi.fn(async () => ({
      bytes: Buffer.from("validated-private-image"),
      mimeType: "image/png" as const,
      width: 100,
      height: 80,
      sha256: "20ebcf0eb8cdf35c6bf44ddc60835a7f149b7e01e53983ef46b3cfb303671b2c",
    })),
  };
  const attachmentStore = {
    save: vi.fn(async () => ({ storageKey })),
    read: vi.fn(async () => Buffer.from("validated-private-image")),
    remove: vi.fn(async () => undefined),
  };
  const imageProvider = {
    providerKind: "mock" as const,
    model: "mock-image",
    analyze: vi.fn(async () => ({
      analysis,
      provider: "mock" as const,
      model: "mock-image",
      usage: { inputTokens: 10, cachedInputTokens: 2, outputTokens: 4 },
      estimatedCostMicrousd: 20,
      latencyMs: 5,
    })),
  };
  const processor = createAttachmentProcessor({
    repository,
    sourceReader,
    attachmentStore,
    imageProvider,
    budget: {
      reservationMicrousd: 2_000,
      dailyHardStopMicrousd: 1_000_000,
      totalHardStopMicrousd: 5_000_000,
    },
    now: () => new Date("2026-08-17T00:00:00.000Z"),
  });
  const request = {
    messageId: "message-1",
    attachmentIds: ["attachment-1"],
    sources: [{
      externalAttachmentKey: "mid-1:0",
      ordinal: 0,
      kind: "image" as const,
      sourceRef: { kind: "facebook_remote" as const, url: "https://scontent.test/private.png" },
      mimeTypeHint: null,
    }],
  };
  return { repository, sourceReader, attachmentStore, imageProvider, processor, request };
}

describe("attachment processor", () => {
  it("persists storage, reserves the shared budget, analyzes once, persists usage, then deletes", async () => {
    const current = setup();
    await expect(current.processor.process(current.request)).resolves.toEqual({
      status: "analyzed",
      summary: analysis.safeSummary,
    });
    expect(current.sourceReader.read).toHaveBeenCalledBefore(current.attachmentStore.save);
    expect(current.attachmentStore.save).toHaveBeenCalledBefore(current.repository.markImageAttachmentStored);
    expect(current.repository.reserveImageAnalysisAttempt).toHaveBeenCalledBefore(current.imageProvider.analyze);
    expect(current.imageProvider.analyze).toHaveBeenCalledTimes(1);
    expect(current.repository.completeImageAnalysisAttempt).toHaveBeenCalledWith(expect.objectContaining({
      status: "analyzed",
      analysisResult: analysis,
      inputTokens: 10,
      cachedInputTokens: 2,
      outputTokens: 4,
      estimatedCostMicrousd: 20,
    }));
    expect(current.repository.completeImageAnalysisAttempt).toHaveBeenCalledBefore(current.attachmentStore.remove);
    expect(current.attachmentStore.remove).toHaveBeenCalledWith(storageKey);
    expect(current.repository.markImageAttachmentDeleted).toHaveBeenCalledWith({
      attachmentId: "attachment-1",
      deleted: true,
      failureCode: null,
    });
  });

  it("fails invalid input closed without storage, budget or provider calls", async () => {
    const current = setup();
    current.sourceReader.read.mockRejectedValueOnce(new Error("private invalid image"));
    await expect(current.processor.process(current.request)).resolves.toEqual({
      status: "image_review_required",
      code: "image_input_rejected",
    });
    expect(current.attachmentStore.save).not.toHaveBeenCalled();
    expect(current.repository.reserveImageAnalysisAttempt).not.toHaveBeenCalled();
    expect(current.imageProvider.analyze).not.toHaveBeenCalled();
    expect(current.repository.completeImageAnalysisAttempt).toHaveBeenCalledWith(expect.objectContaining({
      status: "input_rejected",
      providerCalled: false,
      validatorCodes: ["image_input_rejected"],
    }));
  });

  it("deletes stored objects in finally when the shared budget blocks the provider", async () => {
    const current = setup();
    current.repository.reserveImageAnalysisAttempt.mockResolvedValueOnce({ status: "budget_blocked" });
    await expect(current.processor.process(current.request)).resolves.toEqual({
      status: "image_review_required",
      code: "image_budget_blocked",
    });
    expect(current.imageProvider.analyze).not.toHaveBeenCalled();
    expect(current.attachmentStore.remove).toHaveBeenCalledWith(storageKey);
    expect(current.repository.completeImageAnalysisAttempt).toHaveBeenCalledWith(expect.objectContaining({
      status: "input_rejected",
      providerCalled: false,
      validatorCodes: ["image_budget_blocked"],
    }));
  });

  it("records one provider failure and deletes in finally without retry", async () => {
    const current = setup();
    current.imageProvider.analyze.mockRejectedValueOnce(new Error("private provider response"));
    await expect(current.processor.process(current.request)).resolves.toEqual({
      status: "image_review_required",
      code: "image_provider_error",
    });
    expect(current.imageProvider.analyze).toHaveBeenCalledTimes(1);
    expect(current.repository.completeImageAnalysisAttempt).toHaveBeenCalledWith(expect.objectContaining({
      status: "provider_error",
      providerCalled: true,
      providerErrorCode: "image_provider_error",
    }));
    expect(current.attachmentStore.remove).toHaveBeenCalledWith(storageKey);
  });

  it("preserves provider usage when the first analysis persistence commit fails", async () => {
    const current = setup();
    current.repository.completeImageAnalysisAttempt.mockRejectedValueOnce(new Error("private database error"));
    await expect(current.processor.process(current.request)).resolves.toEqual({
      status: "image_review_required",
      code: "image_persistence_error",
    });
    expect(current.imageProvider.analyze).toHaveBeenCalledTimes(1);
    expect(current.repository.completeImageAnalysisAttempt).toHaveBeenCalledTimes(2);
    expect(current.repository.completeImageAnalysisAttempt).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "provider_error",
      providerCalled: true,
      provider: "mock",
      model: "mock-image",
      inputTokens: 10,
      cachedInputTokens: 2,
      outputTokens: 4,
      estimatedCostMicrousd: 20,
      reservedCostMicrousd: 2_000,
      providerErrorCode: "image_persistence_error",
    }));
    expect(current.attachmentStore.remove).toHaveBeenCalledWith(storageKey);
  });

  it("fails closed and retains the cleanup guard when immediate deletion fails", async () => {
    const current = setup();
    current.attachmentStore.remove.mockRejectedValueOnce(new Error("private delete error"));
    await expect(current.processor.process(current.request)).resolves.toEqual({
      status: "image_review_required",
      code: "image_cleanup_failed",
    });
    expect(current.attachmentStore.remove).toHaveBeenCalledTimes(1);
    expect(current.repository.markImageAttachmentDeleted).toHaveBeenCalledWith({
      attachmentId: "attachment-1",
      deleted: false,
      failureCode: "image_cleanup_failed",
    });
  });

  it("rejects a source and selected-attachment mismatch before any image I/O", async () => {
    const current = setup();
    await expect(current.processor.process({ ...current.request, attachmentIds: [] })).resolves.toEqual({
      status: "image_review_required",
      code: "image_context_mismatch",
    });
    expect(current.sourceReader.read).not.toHaveBeenCalled();
    expect(current.imageProvider.analyze).not.toHaveBeenCalled();
    expect(current.repository.createImageAnalysisAttempt).not.toHaveBeenCalled();
  });
});
