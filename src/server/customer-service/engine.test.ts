import { describe, expect, it, vi } from "vitest";
import { createAttachmentProcessor } from "./attachments/attachment-processor";
import { CustomerServiceEngine } from "./engine";
import type { ImageAnalysisResult } from "./image-analysis-schema";
import compiledKnowledge from "./knowledge/compiled-knowledge.json";
import { validateDraft } from "./output-validator";
import { evaluatePolicyGate } from "./policy-gate";
import type { CustomerServiceRepository } from "./repositories/customer-service-repository";

const safeAnalysis: ImageAnalysisResult = {
  schemaVersion: "1",
  overallStatus: "assessed",
  images: [{
    ordinal: 0,
    classification: "screenshot_of_photo",
    blur: "mild",
    sourceResolutionSignal: "low",
    subjectScale: "usable",
    crop: "none_visible",
    obstruction: "none_visible",
    screenshotSignal: "likely",
    recommendedRole: "main_candidate",
    issueCodes: ["request_original"],
  }],
  comparison: null,
  recommendationCodes: ["send_original_file"],
  safeSummary: "Image 0 appears to be a screenshot; request the original file.",
};

function repositoryFor(body: string, withImage = false) {
  const methods = {
    loadDraftInput: vi.fn(async () => ({
      current: { id: "message-1", body, channel: "facebook" as const },
      context: [body],
    })),
    selectImageContext: vi.fn<CustomerServiceRepository["selectImageContext"]>(async () => withImage ? ({
      messageId: "message-1",
      attachmentIds: ["attachment-1"],
      analysisSummary: null,
    }) : null),
    createGateBlockedAttempt: vi.fn(async () => "attempt-blocked"),
    createImageAnalysisAttempt: vi.fn(async () => "image-attempt-1"),
    markImageAttachmentStored: vi.fn(async () => undefined),
    reserveImageAnalysisAttempt: vi.fn<CustomerServiceRepository["reserveImageAnalysisAttempt"]>(async () => ({ status: "reserved" as const })),
    completeImageAnalysisAttempt: vi.fn(async () => undefined),
    markImageAttachmentDeleted: vi.fn(async () => undefined),
    reserveProviderAttempt: vi.fn(async () => ({ status: "reserved" as const, attemptId: "attempt-1" })),
    completeProviderAttempt: vi.fn(async () => undefined),
  };
  return methods as typeof methods & CustomerServiceRepository;
}

function textProvider(text = "Please send the original photo and we can assess it for you 😊") {
  return {
    providerKind: "mock" as const,
    model: "mock",
    generate: vi.fn(async () => ({
      text,
      provider: "mock" as const,
      model: "mock",
      usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
      estimatedCostMicrousd: 0,
      latencyMs: 1,
    })),
  };
}

function imageDependencies(repository: CustomerServiceRepository) {
  const sourceReader = {
    channel: "facebook" as const,
    read: vi.fn(async () => ({
      bytes: Buffer.from("validated-private-image"),
      mimeType: "image/png" as const,
      width: 10,
      height: 10,
      sha256: "20ebcf0eb8cdf35c6bf44ddc60835a7f149b7e01e53983ef46b3cfb303671b2c",
    })),
  };
  const attachmentStore = {
    save: vi.fn(async () => ({ storageKey: "customer-service-attachments/00000000-0000-4000-8000-000000000001.bin" })),
    read: vi.fn(async () => Buffer.from("validated-private-image")),
    remove: vi.fn(async () => undefined),
  };
  const imageProvider = {
    providerKind: "mock" as const,
    model: "mock-image",
    analyze: vi.fn(async () => ({
      analysis: safeAnalysis,
      provider: "mock" as const,
      model: "mock-image",
      usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5 },
      estimatedCostMicrousd: 20,
      latencyMs: 2,
    })),
  };
  return {
    sourceReader,
    attachmentStore,
    imageProvider,
    processor: createAttachmentProcessor({
      repository,
      sourceReader,
      attachmentStore,
      imageProvider,
      sourceIdentitySecret: "engine-test-source-identity-secret",
      budget: {
        reservationMicrousd: 2_000,
        dailyHardStopMicrousd: 1_000_000,
        totalHardStopMicrousd: 5_000_000,
      },
    }),
  };
}

function setup(body: string, input: Readonly<{
  reply?: string;
  withImage?: boolean;
  previousAnalysis?: string;
  imageAnalysisEnabled?: boolean;
}> = {}) {
  const repository = repositoryFor(body, input.withImage);
  if (input.previousAnalysis) {
    repository.selectImageContext.mockResolvedValue({
      messageId: "message-1",
      attachmentIds: ["attachment-1"],
      analysisSummary: input.previousAnalysis,
    });
  }
  const provider = textProvider(input.reply);
  const image = imageDependencies(repository);
  const policyGate = vi.fn(evaluatePolicyGate);
  const outputValidator = vi.fn(validateDraft);
  return {
    repository,
    provider,
    image,
    policyGate,
    outputValidator,
    engine: new CustomerServiceEngine({
      repository,
      provider,
      attachmentProcessor: input.imageAnalysisEnabled === false ? undefined : image.processor,
      policyGate,
      outputValidator,
      knowledge: compiledKnowledge,
      budget: {
        reservationMicrousd: 1_000,
        dailyHardStopMicrousd: 1_000_000,
        totalHardStopMicrousd: 5_000_000,
      },
    }),
  };
}

const attachmentContext = [{
  externalAttachmentKey: "mid-1:0",
  ordinal: 0,
  kind: "image" as const,
  sourceRef: { kind: "facebook_remote" as const, url: "https://scontent.test/private.png" },
  mimeTypeHint: null,
}];

describe("CustomerServiceEngine", () => {
  it.each([
    ["I want a refund", "gate_blocked"],
    ["How much is an A1 canvas today?", "realtime_required"],
    ["How many free revisions do I get?", "gate_blocked"],
  ])("blocks before every image and text dependency: %s", async (message, expected) => {
    const current = setup(message, { withImage: true });
    await expect(current.engine.generateDraft(
      { messageId: "message-1", trigger: "manual_generate" },
      attachmentContext,
    )).resolves.toMatchObject({ status: expected });
    expect(current.repository.selectImageContext).not.toHaveBeenCalled();
    expect(current.image.sourceReader.read).not.toHaveBeenCalled();
    expect(current.image.imageProvider.analyze).not.toHaveBeenCalled();
    expect(current.provider.generate).not.toHaveBeenCalled();
  });

  it("runs policy, source read, image analysis, text generation and output validation in order", async () => {
    const current = setup("Can you use my blurry original photo?", { withImage: true });
    await expect(current.engine.generateDraft(
      { messageId: "message-1", trigger: "webhook_after" },
      attachmentContext,
    )).resolves.toEqual({ status: "draft_ready", attemptId: "attempt-1" });
    expect(current.policyGate).toHaveBeenCalledBefore(current.image.sourceReader.read);
    expect(current.image.sourceReader.read).toHaveBeenCalledBefore(current.image.imageProvider.analyze);
    expect(current.image.imageProvider.analyze).toHaveBeenCalledBefore(current.provider.generate);
    expect(current.outputValidator).toHaveBeenCalledAfter(current.provider.generate);
  });

  it("uses no image dependency on the frozen text-only path", async () => {
    const current = setup("Can you use my blurry original photo?");
    await expect(current.engine.generateDraft({ messageId: "message-1", trigger: "manual_generate" }))
      .resolves.toEqual({ status: "draft_ready", attemptId: "attempt-1" });
    expect(current.repository.selectImageContext).toHaveBeenCalledTimes(1);
    expect(current.image.sourceReader.read).not.toHaveBeenCalled();
    expect(current.image.attachmentStore.save).not.toHaveBeenCalled();
    expect(current.image.imageProvider.analyze).not.toHaveBeenCalled();
    expect(current.provider.generate).toHaveBeenCalledTimes(1);
  });

  it("preserves the text-only path when image analysis is disabled", async () => {
    const current = setup("Can you use my blurry original photo?", { imageAnalysisEnabled: false });

    await expect(current.engine.generateDraft({ messageId: "message-1", trigger: "manual_generate" }))
      .resolves.toEqual({ status: "draft_ready", attemptId: "attempt-1" });

    expect(current.repository.selectImageContext).toHaveBeenCalledTimes(1);
    expect(current.image.imageProvider.analyze).not.toHaveBeenCalled();
    expect(current.provider.generate).toHaveBeenCalledTimes(1);
  });

  it.each(["manual_generate", "manual_regenerate"] as const)(
    "fails closed after policy when image analysis is disabled for an attachment context: %s",
    async (trigger) => {
      const current = setup("Can you use my blurry original photo?", {
        withImage: true,
        imageAnalysisEnabled: false,
      });

      await expect(current.engine.generateDraft({ messageId: "message-1", trigger }))
        .resolves.toEqual({ status: "image_review_required", attemptId: "attempt-blocked" });

      expect(current.policyGate).toHaveBeenCalledBefore(current.repository.selectImageContext);
      expect(current.repository.createGateBlockedAttempt).toHaveBeenCalledWith(expect.objectContaining({
        gateReasons: ["image_analysis_unavailable"],
      }));
      expect(current.image.imageProvider.analyze).not.toHaveBeenCalled();
      expect(current.provider.generate).not.toHaveBeenCalled();
    },
  );

  it("reuses a validated image summary for manual regeneration when analysis is disabled", async () => {
    const current = setup("Can you use my blurry original photo?", {
      withImage: true,
      previousAnalysis: safeAnalysis.safeSummary,
      imageAnalysisEnabled: false,
    });

    await expect(current.engine.generateDraft({ messageId: "message-1", trigger: "manual_regenerate" }))
      .resolves.toEqual({ status: "draft_ready", attemptId: "attempt-1" });

    expect(current.image.imageProvider.analyze).not.toHaveBeenCalled();
    expect(current.provider.generate).toHaveBeenCalledWith(expect.objectContaining({
      instructions: expect.stringContaining(`VISUAL ASSESSMENT:\n${safeAnalysis.safeSummary}`),
    }));
  });

  it("keeps image-only messages away from both providers", async () => {
    const current = setup("[Image attachment]", { withImage: true });
    await expect(current.engine.generateDraft(
      { messageId: "message-1", trigger: "webhook_after" },
      attachmentContext,
    )).resolves.toMatchObject({ status: "gate_blocked" });
    expect(current.image.imageProvider.analyze).not.toHaveBeenCalled();
    expect(current.provider.generate).not.toHaveBeenCalled();
  });

  it("fails closed before text generation when image input is invalid", async () => {
    const current = setup("Can you use my blurry original photo?", { withImage: true });
    current.image.sourceReader.read.mockRejectedValueOnce(new Error("private invalid input"));
    await expect(current.engine.generateDraft(
      { messageId: "message-1", trigger: "webhook_after" },
      attachmentContext,
    )).resolves.toEqual({ status: "image_review_required", attemptId: "attempt-blocked" });
    expect(current.image.imageProvider.analyze).not.toHaveBeenCalled();
    expect(current.provider.generate).not.toHaveBeenCalled();
  });

  it("fails closed without retry or text generation when the image provider fails", async () => {
    const current = setup("Can you use my blurry original photo?", { withImage: true });
    current.image.imageProvider.analyze.mockRejectedValueOnce(new Error("private provider body"));
    await expect(current.engine.generateDraft(
      { messageId: "message-1", trigger: "webhook_after" },
      attachmentContext,
    )).resolves.toEqual({ status: "image_review_required", attemptId: "attempt-blocked" });
    expect(current.image.imageProvider.analyze).toHaveBeenCalledTimes(1);
    expect(current.provider.generate).not.toHaveBeenCalled();
  });

  it("reuses a validated previous summary only on manual regenerate", async () => {
    const current = setup("Can you use my blurry original photo?", {
      withImage: true,
      previousAnalysis: safeAnalysis.safeSummary,
    });
    await expect(current.engine.generateDraft({ messageId: "message-1", trigger: "manual_regenerate" }))
      .resolves.toEqual({ status: "draft_ready", attemptId: "attempt-1" });
    expect(current.image.sourceReader.read).not.toHaveBeenCalled();
    expect(current.image.imageProvider.analyze).not.toHaveBeenCalled();
    expect(current.provider.generate).toHaveBeenCalledWith(expect.objectContaining({
      instructions: expect.stringContaining(`VISUAL ASSESSMENT:\n${safeAnalysis.safeSummary}`),
    }));
  });

  it("requires human review when selected attachments have no safe source or prior analysis", async () => {
    const current = setup("Can you use my blurry original photo?", { withImage: true });
    await expect(current.engine.generateDraft({ messageId: "message-1", trigger: "manual_generate" }))
      .resolves.toEqual({ status: "image_review_required", attemptId: "attempt-blocked" });
    expect(current.image.imageProvider.analyze).not.toHaveBeenCalled();
    expect(current.provider.generate).not.toHaveBeenCalled();
  });

  it("requires both text and visual validators to accept an image-aware draft", async () => {
    const current = setup("Can you use my blurry original photo?", {
      withImage: true,
      reply: "This photo is suitable for print.",
    });
    await expect(current.engine.generateDraft(
      { messageId: "message-1", trigger: "webhook_after" },
      attachmentContext,
    )).resolves.toEqual({ status: "output_blocked", attemptId: "attempt-1" });
    expect(current.repository.completeProviderAttempt).toHaveBeenCalledWith(expect.objectContaining({
      status: "output_blocked",
      validatorCodes: ["visual_print_suitability_claim"],
      rejectedOutputHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
  });

  it("returns a safe text provider error and persists no raw error", async () => {
    const current = setup("Can you use my blurry original photo?");
    current.provider.generate.mockRejectedValueOnce(new Error("private provider body"));
    await expect(current.engine.generateDraft({ messageId: "message-1", trigger: "manual_generate" }))
      .resolves.toEqual({ status: "provider_error", attemptId: "attempt-1" });
    expect(current.repository.completeProviderAttempt).toHaveBeenCalledWith(expect.objectContaining({
      status: "provider_error",
      providerErrorCode: "provider_request_failed",
    }));
  });
});
