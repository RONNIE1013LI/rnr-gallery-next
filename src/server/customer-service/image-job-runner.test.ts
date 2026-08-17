import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ImageAnalysisInputRecord } from "./repositories/customer-service-repository";
import { createImageJobRunner, type ClaimedImageJob } from "./image-job-runner";

const now = new Date("2026-08-17T00:00:00.000Z");
const leaseToken = "00000000-0000-4000-8000-000000000201";
const storageKey = "customer-service-attachments/00000000-0000-4000-8000-000000000202.bin";
const bytes = Buffer.from("validated-private-image");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const source = {
  ordinal: 0,
  externalAttachmentKeyHash: "a".repeat(64),
  sourceRef: { kind: "facebook_remote" as const, url: "https://scontent.test/private.png" },
};

function job(stage: ClaimedImageJob["stage"], overrides: Partial<ClaimedImageJob> = {}): ClaimedImageJob {
  return {
    id: "00000000-0000-4000-8000-000000000101",
    messageId: "00000000-0000-4000-8000-000000000102",
    stage,
    leaseToken,
    sourceCiphertext: stage === "download" ? "v1.encrypted" : null,
    sourceExpiresAt: stage === "download" ? new Date("2026-08-17T00:15:00.000Z") : null,
    imageAnalysisAttemptId: stage === "policy" || stage === "download" ? null : "image-attempt-1",
    hasUnsupportedAttachments: false,
    terminalAfterCleanup: false,
    failureCode: null,
    ...overrides,
  };
}

function setup(claimed: ClaimedImageJob) {
  const events: string[] = [];
  const repository = {
    reconcileStaleImageJobs: vi.fn(async () => ({ examined: 0, resumed: 0, terminal: 0, reservationsReleased: 0 })),
    claimImageJob: vi.fn(async () => claimed),
    completeImageJobStage: vi.fn(async (input) => { events.push(`stage:${input.nextStage}`); return true; }),
    finishImageJob: vi.fn(async (input) => { events.push(`finish:${input.status}`); return true; }),
    ensureImageAnalysisAttemptForJob: vi.fn(async (): Promise<{
      attemptId: string;
      inputs: Array<ImageAnalysisInputRecord & { externalAttachmentKeyHash: string }>;
    }> => ({
      attemptId: "image-attempt-1",
      inputs: [{
        attachmentId: "attachment-1",
        ordinal: 0,
        externalAttachmentKeyHash: source.externalAttachmentKeyHash,
        cleanupStatus: "pending" as const,
        privateStorageKey: null,
        verifiedMimeType: null,
        byteSize: null,
        sha256: null,
      }],
    })),
    prepareImageAttachmentStorage: vi.fn(async () => { events.push("storage:prepared"); }),
    markImageAttachmentStored: vi.fn(async () => { events.push("storage:recorded"); }),
    loadImageAnalysisInputs: vi.fn(async () => [{
      attachmentId: "attachment-1",
      ordinal: 0,
      cleanupStatus: "stored" as const,
      privateStorageKey: storageKey,
      verifiedMimeType: "image/png" as const,
      byteSize: bytes.byteLength,
      sha256,
    }]),
    reserveImageJobBudget: vi.fn(async () => { events.push("budget:reserved"); return { status: "reserved" as const }; }),
    markImageAnalysisProviderStarted: vi.fn(async () => { events.push("vision:started"); return true; }),
    completeImageAnalysisAttempt: vi.fn(async () => { events.push("vision:recorded"); }),
    cleanupImageAttemptInputs: vi.fn(async () => ({ selected: 1, deleted: 1, failed: 0 })),
    loadImageJobAssessment: vi.fn(async () => "Image 0 appears to be a screenshot; request the original file."),
  };
  const policyCheck = vi.fn(async () => ({ status: "allowed" as const }));
  const sourceProtector = { open: vi.fn(() => [source]) };
  const sourceReader = {
    channel: "facebook" as const,
    read: vi.fn(async () => ({ bytes, mimeType: "image/png" as const, width: 20, height: 10, sha256 })),
  };
  const store = {
    allocateKey: vi.fn(() => storageKey),
    save: vi.fn(async () => { events.push("storage:uploaded"); }),
    read: vi.fn(async () => bytes),
    remove: vi.fn(async () => undefined),
  };
  const imageProvider = {
    providerKind: "mock" as const,
    model: "mock-image",
    analyze: vi.fn(async () => {
      events.push("vision:called");
      return {
        analysis: {
          schemaVersion: "1" as const,
          overallStatus: "assessed" as const,
          images: [{
            ordinal: 0,
            classification: "customer_photo" as const,
            blur: "none_visible" as const,
            sourceResolutionSignal: "normal" as const,
            subjectScale: "usable" as const,
            crop: "none_visible" as const,
            obstruction: "none_visible" as const,
            screenshotSignal: "none_visible" as const,
            recommendedRole: "main_candidate" as const,
            issueCodes: [],
          }],
          comparison: null,
          recommendationCodes: ["use_as_main_candidate" as const],
          safeSummary: "Image 0 is the likely main candidate.",
        },
        provider: "mock" as const,
        model: "mock-image",
        usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5 },
        estimatedCostMicrousd: 25,
        latencyMs: 5,
      };
    }),
  };
  const generateDraft = vi.fn(async () => ({ status: "draft_ready" as const, attemptId: "text-attempt-1" }));
  const runner = createImageJobRunner({
    repository,
    policyCheck,
    sourceProtector,
    sourceReader,
    store,
    imageProvider,
    generateDraft,
    budget: {
      imageReservationMicrousd: 1_000,
      textReservationMicrousd: 1_000,
      dailyHardStopMicrousd: 10_000,
      totalHardStopMicrousd: 20_000,
    },
    now: () => now,
  });
  return { events, repository, policyCheck, sourceProtector, sourceReader, store, imageProvider, generateDraft, runner };
}

describe("durable image job runner", () => {
  it.each(["policy", "download", "vision", "draft"] as const)(
    "routes a recovered %s image job to human review before source or provider access",
    async (stage) => {
      const current = setup(job(stage));

      await expect(current.runner.runOnce({ jobId: "00000000-0000-4000-8000-000000000101" }))
        .resolves.toMatchObject({ claimed: 1, completed: 0, humanReviewRequired: 1 });

      expect(current.sourceProtector.open).not.toHaveBeenCalled();
      expect(current.sourceReader.read).not.toHaveBeenCalled();
      expect(current.store.read).not.toHaveBeenCalled();
      expect(current.imageProvider.analyze).not.toHaveBeenCalled();
      expect(current.generateDraft).not.toHaveBeenCalled();
    },
  );

  it("blocks policy and unsupported jobs before decrypting or calling either provider", async () => {
    const current = setup(job("policy", { hasUnsupportedAttachments: true }));

    await expect(current.runner.runOnce({ jobId: "00000000-0000-4000-8000-000000000101" }))
      .resolves.toMatchObject({ claimed: 1, humanReviewRequired: 1 });

    expect(current.policyCheck).toHaveBeenCalledOnce();
    expect(current.sourceProtector.open).not.toHaveBeenCalled();
    expect(current.imageProvider.analyze).not.toHaveBeenCalled();
    expect(current.generateDraft).not.toHaveBeenCalled();
    expect(current.repository.finishImageJob).toHaveBeenCalledWith(expect.objectContaining({
      status: "human_review_required",
      failureCode: "unsupported_attachment",
    }));
  });

  it("cleans any previously stored image input before closing a recovered cleanup job", async () => {
    const current = setup(job("cleanup"));

    await expect(current.runner.runOnce({ jobId: "00000000-0000-4000-8000-000000000101" }))
      .resolves.toMatchObject({ claimed: 1, completed: 0, humanReviewRequired: 1 });

    expect(current.repository.cleanupImageAttemptInputs).toHaveBeenCalledOnce();
    expect(current.repository.finishImageJob).toHaveBeenCalledWith(expect.objectContaining({
      status: "human_review_required",
      failureCode: "image_manual_review_required",
    }));
    expect(current.imageProvider.analyze).not.toHaveBeenCalled();
    expect(current.generateDraft).not.toHaveBeenCalled();
  });
});
