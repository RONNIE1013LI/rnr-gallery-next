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

function repositoryFor(body: string | null, withImage = false) {
  const methods = {
    loadDraftInput: vi.fn<CustomerServiceRepository["loadDraftInput"]>(async () => ({
      current: { id: "message-1", text: body, channel: "facebook" as const },
      context: body === null ? [] : [{
        role: "customer" as const,
        text: body,
        receivedAt: "2026-08-18T00:00:00.000Z",
      }],
    })),
    selectImageContext: vi.fn<CustomerServiceRepository["selectImageContext"]>(async () => withImage ? ({
      messageId: "message-1",
      attachmentIds: ["attachment-1"],
      analysisSummary: null,
      hasUnsupportedAttachments: false,
    }) : null),
    createGateBlockedAttempt: vi.fn(async () => "attempt-blocked"),
    createImageAnalysisAttempt: vi.fn(async () => "image-attempt-1"),
    markImageAttachmentStored: vi.fn(async () => undefined),
    reserveImageAnalysisAttempt: vi.fn<CustomerServiceRepository["reserveImageAnalysisAttempt"]>(async () => ({ status: "reserved" as const })),
    completeImageAnalysisAttempt: vi.fn(async () => undefined),
    markImageAttachmentDeleted: vi.fn(async () => undefined),
    reserveProviderAttempt: vi.fn(async () => ({ status: "reserved" as const, attemptId: "attempt-1" })),
    confirmProviderInvocation: vi.fn<CustomerServiceRepository["confirmProviderInvocation"]>(
      async () => ({ status: "allowed" as const }),
    ),
    retrieveApprovedCaseMemories: vi.fn<CustomerServiceRepository["retrieveApprovedCaseMemories"]>(async () => []),
    createImageJobProviderAttempt: vi.fn<CustomerServiceRepository["createImageJobProviderAttempt"]>(
      async () => ({ status: "reserved" as const, attemptId: "attempt-image-text-1" }),
    ),
    completeProviderAttempt: vi.fn(async () => undefined),
  };
  return methods as typeof methods & CustomerServiceRepository;
}

function textProvider(text = "Please send the original photo and we can assess it for you 😊") {
  return {
    providerKind: "mock" as const,
    model: "mock",
    generate: vi.fn(async (prompt: Readonly<{ instructions: string; input: string }>) => {
      void prompt;
      return {
        text,
        provider: "mock" as const,
        model: "mock",
        usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
        estimatedCostMicrousd: 0,
        latencyMs: 1,
      };
    }),
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
    allocateKey: vi.fn(() => "customer-service-attachments/00000000-0000-4000-8000-000000000001.bin"),
    save: vi.fn(async () => undefined),
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

function setup(body: string | null, input: Readonly<{
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
      hasUnsupportedAttachments: false,
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
  it.each(["manual_generate", "manual_regenerate"] as const)(
    "routes image-bearing messages to human review without image or text providers: %s",
    async (trigger) => {
      const current = setup("Can you use my blurry original photo?", {
        withImage: true,
        previousAnalysis: safeAnalysis.safeSummary,
      });

      await expect(current.engine.generateDraft(
        { messageId: "message-1", trigger },
        attachmentContext,
      )).resolves.toEqual({ status: "image_review_required", attemptId: "attempt-blocked" });

      expect(current.repository.createGateBlockedAttempt).toHaveBeenCalledWith(expect.objectContaining({
        gateReasons: ["image_manual_review_required"],
      }));
      expect(current.image.sourceReader.read).not.toHaveBeenCalled();
      expect(current.image.attachmentStore.read).not.toHaveBeenCalled();
      expect(current.image.imageProvider.analyze).not.toHaveBeenCalled();
      expect(current.provider.generate).not.toHaveBeenCalled();
    },
  );

  it("keeps the durable image-aware draft entry point provider-free", async () => {
    const current = setup("Can you use my blurry original photo?", { withImage: true });

    await expect(current.engine.generateImageAwareDraft({
      messageId: "message-1",
      imageJobId: "image-job-1",
      leaseToken: "lease-1",
      visualAssessment: safeAnalysis.safeSummary,
    })).resolves.toEqual({ status: "image_review_required", attemptId: "attempt-blocked" });

    expect(current.repository.createImageJobProviderAttempt).not.toHaveBeenCalled();
    expect(current.provider.generate).not.toHaveBeenCalled();
  });

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

  it("does not call the provider when a human echo arrives after reservation", async () => {
    const current = setup("Can you explain the design process?");
    current.repository.confirmProviderInvocation.mockResolvedValueOnce({ status: "human_reply_received" });

    await expect(current.engine.generateDraft({ messageId: "message-1", trigger: "webhook_after" }))
      .resolves.toEqual({ status: "human_reply_received", attemptId: "attempt-1" });

    expect(current.repository.reserveProviderAttempt).toHaveBeenCalledOnce();
    expect(current.repository.confirmProviderInvocation).toHaveBeenCalledWith({
      attemptId: "attempt-1",
      dailyScopeKey: expect.stringMatching(/^daily:/),
    });
    expect(current.provider.generate).not.toHaveBeenCalled();
  });

  it("retrieves approved cases only after an allowed gate and before provider invocation", async () => {
    const current = setup("Can you explain the design process?");
    current.repository.retrieveApprovedCaseMemories.mockResolvedValueOnce([{
      id: "case-1", normalizedSituation: "Similar design-process question.",
      humanFinalReply: "Please send your photos, wording and theme.", score: 95,
    }]);
    await expect(current.engine.generateDraft({ messageId: "message-1", trigger: "manual_generate" }))
      .resolves.toEqual({ status: "draft_ready", attemptId: "attempt-1" });
    expect(current.repository.retrieveApprovedCaseMemories).toHaveBeenCalledWith(expect.objectContaining({
      attemptId: "attempt-1", query: "Can you explain the design process?", limit: 3,
    }));
    expect(current.repository.confirmProviderInvocation).toHaveBeenCalledAfter(current.repository.retrieveApprovedCaseMemories);
    expect(current.provider.generate).toHaveBeenCalledOnce();
  });

  it.each([
    ["I want a refund", "gate_blocked"],
    ["How much is shipping today?", "realtime_required"],
  ])("never retrieves experience for blocked message %s", async (message, expected) => {
    const current = setup(message);
    await expect(current.engine.generateDraft({ messageId: "message-1", trigger: "manual_generate" }))
      .resolves.toMatchObject({ status: expected });
    expect(current.repository.retrieveApprovedCaseMemories).not.toHaveBeenCalled();
    expect(current.provider.generate).not.toHaveBeenCalled();
  });

  it("uses same-conversation staff context to interpret a short location reply", async () => {
    const current = setup("Australia");
    current.repository.loadDraftInput.mockResolvedValue({
      current: { id: "message-1", text: "Australia", channel: "facebook" },
      context: [
        { role: "staff", text: "Which country are you in?", receivedAt: "2026-08-18T00:00:00.000Z" },
        { role: "customer", text: "Australia", receivedAt: "2026-08-18T00:00:01.000Z" },
      ],
    });

    await expect(current.engine.generateDraft({ messageId: "message-1", trigger: "manual_generate" }))
      .resolves.toEqual({ status: "draft_ready", attemptId: "attempt-1" });
    expect(current.policyGate).toHaveBeenCalledWith(expect.objectContaining({
      message: "Australia",
      intentOverride: "quote_information_collection",
    }));
    expect(current.provider.generate).toHaveBeenCalledOnce();
  });

  it("minimizes Website conversation input after policy gate and includes only safe product identity", async () => {
    const raw = "Can you explain the design process? Email tina@example.com or call +64 21 123 4567.";
    const current = setup(raw);
    current.repository.loadDraftInput.mockResolvedValue({
      current: {
        id: "message-1",
        text: raw,
        channel: "website",
        productContext: {
          market: "NZ",
          productKey: "digital-oil-painting-canvas",
          productTitle: "Digital Oil Painting Canvas",
          category: "canvas",
          pageKind: "product",
        },
      },
      context: [{ role: "customer", text: raw, receivedAt: "2026-08-21T00:00:00.000Z" }],
    });

    await expect(current.engine.generateDraft({ messageId: "message-1", trigger: "manual_generate" }))
      .resolves.toEqual({ status: "draft_ready", attemptId: "attempt-1" });

    expect(current.policyGate).toHaveBeenCalledWith(expect.objectContaining({ message: raw }));
    const providerInput = current.provider.generate.mock.calls[0]?.[0];
    if (!providerInput) throw new Error("expected provider input");
    expect(providerInput?.input).not.toContain("tina@example.com");
    expect(providerInput?.input).not.toContain("+64 21 123 4567");
    expect(providerInput?.input).toContain("[email removed]");
    expect(providerInput?.input).toContain("[phone removed]");
    expect(providerInput?.input).toContain("Digital Oil Painting Canvas");
    expect(providerInput?.instructions).not.toContain("Digital Oil Painting Canvas");
    expect(providerInput?.instructions).not.toContain("startingPriceExGstCents");
    expect(providerInput?.instructions).not.toContain("configuration");
  });

  it("routes Website payment identifiers to human review before provider reservation", async () => {
    const raw = "Can you explain the design process using card 4111 1111 1111 1111?";
    const current = setup(raw);
    current.repository.loadDraftInput.mockResolvedValue({
      current: { id: "message-1", text: raw, channel: "website", productContext: null },
      context: [{ role: "customer", text: raw, receivedAt: "2026-08-21T00:00:00.000Z" }],
    });

    await expect(current.engine.generateDraft({ messageId: "message-1", trigger: "manual_generate" }))
      .resolves.toEqual({ status: "gate_blocked", attemptId: "attempt-blocked" });

    expect(current.policyGate).toHaveBeenCalledWith(expect.objectContaining({ message: raw }));
    expect(current.repository.createGateBlockedAttempt).toHaveBeenCalledWith(expect.objectContaining({
      gateReasons: ["website_sensitive_input"],
    }));
    expect(current.repository.reserveProviderAttempt).not.toHaveBeenCalled();
    expect(current.provider.generate).not.toHaveBeenCalled();
  });

  it("redacts historical payment details without blocking a later safe Website turn", async () => {
    const current = setup("Can you explain the design process?");
    current.repository.loadDraftInput.mockResolvedValue({
      current: {
        id: "message-1",
        text: "Can you explain the design process?",
        channel: "website",
        productContext: null,
      },
      context: [
        {
          role: "customer",
          text: "My old card was 4111 1111 1111 1111.",
          receivedAt: "2026-08-20T00:00:00.000Z",
        },
        {
          role: "customer",
          text: "Can you explain the design process?",
          receivedAt: "2026-08-21T00:00:00.000Z",
        },
      ],
    });

    await expect(current.engine.generateDraft({ messageId: "message-1", trigger: "manual_generate" }))
      .resolves.toEqual({ status: "draft_ready", attemptId: "attempt-1" });

    expect(current.repository.reserveProviderAttempt).toHaveBeenCalledOnce();
    expect(current.provider.generate).toHaveBeenCalledOnce();
    expect(current.provider.generate.mock.calls[0]?.[0]?.input).toContain("[payment details removed]");
    expect(current.provider.generate.mock.calls[0]?.[0]?.input).not.toContain("4111");
  });

  it("preserves the Facebook provider prompt without Website minimization", async () => {
    const raw = "Can you explain the design process? Email tina@example.com.";
    const current = setup(raw);

    await expect(current.engine.generateDraft({ messageId: "message-1", trigger: "manual_generate" }))
      .resolves.toEqual({ status: "draft_ready", attemptId: "attempt-1" });

    expect(current.provider.generate.mock.calls[0]?.[0]?.input).toContain("tina@example.com");
  });

  it("does not let contextual intent override a current high-risk message", async () => {
    const current = setup("I want a refund");
    current.repository.loadDraftInput.mockResolvedValue({
      current: { id: "message-1", text: "I want a refund", channel: "facebook" },
      context: [
        { role: "staff", text: "Which size would you like?", receivedAt: "2026-08-18T00:00:00.000Z" },
        { role: "customer", text: "I want a refund", receivedAt: "2026-08-18T00:00:01.000Z" },
      ],
    });

    await expect(current.engine.generateDraft({ messageId: "message-1", trigger: "manual_generate" }))
      .resolves.toMatchObject({ status: "gate_blocked" });
    expect(current.provider.generate).not.toHaveBeenCalled();
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
        gateReasons: ["image_manual_review_required"],
      }));
      expect(current.image.imageProvider.analyze).not.toHaveBeenCalled();
      expect(current.provider.generate).not.toHaveBeenCalled();
    },
  );

  it("keeps image-only messages away from both providers", async () => {
    const current = setup(null, { withImage: true });
    await expect(current.engine.generateDraft(
      { messageId: "message-1", trigger: "webhook_after" },
      attachmentContext,
    )).resolves.toMatchObject({ status: "image_review_required" });
    expect(current.policyGate).not.toHaveBeenCalled();
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

  it("does not invoke a configured image provider for an image-bearing message", async () => {
    const current = setup("Can you use my blurry original photo?", { withImage: true });
    current.image.imageProvider.analyze.mockRejectedValueOnce(new Error("private provider body"));
    await expect(current.engine.generateDraft(
      { messageId: "message-1", trigger: "webhook_after" },
      attachmentContext,
    )).resolves.toEqual({ status: "image_review_required", attemptId: "attempt-blocked" });
    expect(current.image.imageProvider.analyze).not.toHaveBeenCalled();
    expect(current.provider.generate).not.toHaveBeenCalled();
  });

  it("requires human review when selected attachments have no safe source or prior analysis", async () => {
    const current = setup("Can you use my blurry original photo?", { withImage: true });
    await expect(current.engine.generateDraft({ messageId: "message-1", trigger: "manual_generate" }))
      .resolves.toEqual({ status: "image_review_required", attemptId: "attempt-blocked" });
    expect(current.image.imageProvider.analyze).not.toHaveBeenCalled();
    expect(current.provider.generate).not.toHaveBeenCalled();
  });

  it("returns a safe text provider error and persists no raw error", async () => {
    const current = setup("Can you use my blurry original photo?");
    current.provider.generate.mockRejectedValueOnce(new Error("private provider body"));
    await expect(current.engine.generateDraft({ messageId: "message-1", trigger: "manual_generate" }))
      .resolves.toEqual({ status: "provider_error", attemptId: "attempt-1" });
    expect(current.repository.completeProviderAttempt).toHaveBeenCalledWith(expect.objectContaining({
      status: "provider_error",
      providerErrorCode: "provider_request_failed",
      estimatedCostMicrousd: null,
    }));
  });

  it("checks image-job policy from customer_text without selecting or reading attachments", async () => {
    const current = setup("I want a refund", { withImage: true });

    await expect(current.engine.checkImageJobPolicy("message-1")).resolves.toEqual({
      status: "blocked",
      code: "high_risk_topic",
    });

    expect(current.repository.createGateBlockedAttempt).toHaveBeenCalledWith(expect.objectContaining({
      messageId: "message-1",
      trigger: "webhook_after",
      gateReasons: ["high_risk_topic"],
    }));
    expect(current.repository.selectImageContext).not.toHaveBeenCalled();
    expect(current.image.sourceReader.read).not.toHaveBeenCalled();
    expect(current.provider.generate).not.toHaveBeenCalled();
  });

});
