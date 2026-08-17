import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import compiledKnowledge from "../src/server/customer-service/knowledge/compiled-knowledge.json";
import { buildDraftPrompt } from "../src/server/customer-service/prompt-builder";
import { retrieveKnowledge } from "../src/server/customer-service/knowledge-retrieval";
import { evaluatePolicyGate } from "../src/server/customer-service/policy-gate";
import {
  createDeterministicImageEvaluationProviders,
  createOpenAIEvaluationProviders,
  evaluateReplyAssistantImageCases,
  loadImageEvaluationDataset,
  requireOpenAIEvaluationEnvironment,
  writeImageEvaluationReport,
  type EvaluationTextProvider,
  type EvaluationVisionRequest,
  type EvaluationVisionProvider,
} from "./evaluate-reply-assistant-images";

const fixturePath = resolve("src/server/customer-service/fixtures/image-evaluation-cases.jsonl");
const manifestPath = resolve("src/server/customer-service/fixtures/image-evaluation-assets/manifest.json");

describe("reply assistant image evaluation", () => {
  it("loads exactly 80 privacy-safe cases with the required distribution and verified provenance", async () => {
    const dataset = await loadImageEvaluationDataset({ fixturePath, manifestPath });

    expect(dataset.cases).toHaveLength(80);
    expect(dataset.distribution).toEqual({
      blur_low_resolution: 12,
      screenshot_original: 10,
      small_subject: 8,
      heavy_crop: 8,
      obstruction: 8,
      classification: 10,
      comparison: 12,
      blocked_policy: 6,
      provider_input_failure: 6,
    });
    expect(dataset.manifest.assets.length).toBeGreaterThanOrEqual(80);
    expect(dataset.manifest.assets.every((asset) => (
      asset.provenanceCategory === "deterministic_generated_fixture"
      && asset.consentStatus === "not_applicable_generated"
      && asset.permittedUse === "internal_reply_assistant_image_evaluation"
      && /^[a-f0-9]{64}$/.test(asset.sha256)
      && !asset.relativePath.startsWith("/")
      && !asset.relativePath.includes("..")
    ))).toBe(true);
  });

  it("rejects a manifest asset that escapes through a filesystem symlink", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "image-eval-symlink-"));
    const copiedFixtureRoot = join(tempRoot, "fixtures");
    const copiedAssetRoot = join(copiedFixtureRoot, "image-evaluation-assets");
    mkdirSync(copiedFixtureRoot, { recursive: true });
    copyFileSync(fixturePath, join(copiedFixtureRoot, "image-evaluation-cases.jsonl"));
    cpSync(resolve(manifestPath, ".."), copiedAssetRoot, { recursive: true });
    const manifest = JSON.parse(readFileSync(join(copiedAssetRoot, "manifest.json"), "utf8")) as {
      assets: Array<{ relativePath: string }>;
    };
    const escapedAssetPath = join(copiedAssetRoot, manifest.assets[0].relativePath);
    const outsidePath = join(tempRoot, "outside-asset.png");
    copyFileSync(escapedAssetPath, outsidePath);
    unlinkSync(escapedAssetPath);
    symlinkSync(outsidePath, escapedAssetPath);

    await expect(loadImageEvaluationDataset({
      fixturePath: join(copiedFixtureRoot, "image-evaluation-cases.jsonl"),
      manifestPath: join(copiedAssetRoot, "manifest.json"),
    })).rejects.toThrowError("image_evaluation_unsafe_asset_path");
  });

  it("makes zero vision and text calls for blocked policy controls", async () => {
    const dataset = await loadImageEvaluationDataset({ fixturePath, manifestPath });
    const visionProvider: EvaluationVisionProvider = {
      kind: "mock",
      model: "must-not-run",
      networked: false,
      analyze: vi.fn(async () => { throw new Error("unexpected_vision_call"); }),
    };
    const textProvider: EvaluationTextProvider = {
      kind: "mock",
      model: "must-not-run",
      networked: false,
      generate: vi.fn(async () => { throw new Error("unexpected_text_call"); }),
    };

    const report = await evaluateReplyAssistantImageCases({
      dataset: {
        ...dataset,
        cases: dataset.cases.filter((item) => item.category === "blocked_policy"),
      },
      visionProvider,
      textProvider,
    });

    expect(visionProvider.analyze).not.toHaveBeenCalled();
    expect(textProvider.generate).not.toHaveBeenCalled();
    expect(report.summary.blockedProviderAttempts).toEqual({ vision: 0, text: 0, total: 0 });
    expect(report.summary.blockedNetworkCalls).toEqual({ vision: 0, text: 0, total: 0 });
    expect(report.summary.gateBypasses).toBe(0);
  });

  it("runs all 80 deterministic mock cases as harness evidence without fake quality metrics", async () => {
    const dataset = await loadImageEvaluationDataset({ fixturePath, manifestPath });
    const providers = createDeterministicImageEvaluationProviders();
    const report = await evaluateReplyAssistantImageCases({ dataset, ...providers });

    expect(report.summary).toMatchObject({
      totalCases: 80,
      gateBypasses: 0,
      policyViolations: 0,
      rejectedUnsupportedClaims: 0,
      crossCustomerExposures: 0,
      automaticSends: 0,
      blockedProviderAttempts: { vision: 0, text: 0, total: 0 },
      blockedNetworkCalls: { vision: 0, text: 0, total: 0 },
      inputFailures: 3,
      visionProviderFailures: 2,
      textProviderFailures: 1,
      harnessGatePassed: true,
      overallGatePassed: false,
      quality: {
        status: "unavailable_mock_provider",
        visualIssueCoveragePct: null,
        requestOriginalRecallPct: null,
        classificationAccuracyPct: null,
        comparisonAccuracyPct: null,
        requiredPointCoveragePct: null,
        automatedDraftAcceptancePct: null,
        humanAssistedAcceptancePct: null,
        humanReviewedCases: 0,
        gatePassed: null,
      },
    });
    expect(report.results).toHaveLength(80);
    expect(report.results.every((result) => result.assetIds.every((assetId) => !assetId.includes("/")))).toBe(true);
    expect(report.results.every((result) => result.requiredPointCoveragePct === null)).toBe(true);
    expect(report.summary.usage).toMatchObject({
      vision: { attempts: 71, networkCalls: 0, successfulCalls: 69, inputTokens: 0, outputTokens: 0, costMicrousd: 0 },
      text: { attempts: 69, networkCalls: 0, successfulCalls: 68, inputTokens: 0, outputTokens: 0, costMicrousd: 0 },
    });
  });

  it("detects an expected policy block that reaches providers as a bypass", async () => {
    const dataset = await loadImageEvaluationDataset({ fixturePath, manifestPath });
    const blocked = dataset.cases.find((item) => item.category === "blocked_policy")!;
    const providers = createDeterministicImageEvaluationProviders();
    const report = await evaluateReplyAssistantImageCases({
      dataset: {
        ...dataset,
        cases: [{ ...blocked, customerText: "Should I send the original file?" }],
      },
      ...providers,
    });

    expect(report.summary.gateBypasses).toBe(1);
    expect(report.results[0]).toMatchObject({
      gateBypass: true,
      providerAttempts: { vision: true, text: true },
      networkCalls: { vision: false, text: false },
    });
  });

  it("calculates original-file recall from recommendations, not issue codes alone", async () => {
    const dataset = await loadImageEvaluationDataset({ fixturePath, manifestPath });
    const screenshot = dataset.cases.find((item) => item.category === "screenshot_original")!;
    const providers = createDeterministicImageEvaluationProviders();
    const visionProvider: EvaluationVisionProvider = {
      ...providers.visionProvider,
      kind: "openai",
      async analyze(request) {
        const result = await providers.visionProvider.analyze(request);
        return {
          ...result,
          analysis: { ...result.analysis, recommendationCodes: ["human_review"] },
        };
      },
    };
    const report = await evaluateReplyAssistantImageCases({
      dataset: { ...dataset, cases: [screenshot] },
      visionProvider,
      textProvider: { ...providers.textProvider, kind: "openai" },
    });

    expect(report.summary.quality.requestOriginalRecallPct).toBe(0);
  });

  it("does not expose fixture expectations to deterministic providers", async () => {
    const dataset = await loadImageEvaluationDataset({ fixturePath, manifestPath });
    const providers = createDeterministicImageEvaluationProviders();
    const item = dataset.cases.find((candidate) => candidate.category === "classification")!;
    const visionProvider: EvaluationVisionProvider = {
      ...providers.visionProvider,
      analyze: vi.fn(async (request) => {
        expect(request).not.toHaveProperty("expected");
        return providers.visionProvider.analyze(request);
      }),
    };
    const textProvider: EvaluationTextProvider = {
      ...providers.textProvider,
      generate: vi.fn(async (request) => {
        expect(request).not.toHaveProperty("expected");
        return providers.textProvider.generate(request);
      }),
    };

    await evaluateReplyAssistantImageCases({
      dataset: { ...dataset, cases: [item] },
      visionProvider,
      textProvider,
    });

    expect(visionProvider.analyze).toHaveBeenCalledOnce();
    expect(textProvider.generate).toHaveBeenCalledOnce();
  });

  it("requires explicit existing image and text models for real evaluation", () => {
    expect(() => requireOpenAIEvaluationEnvironment({
      OPENAI_API_KEY: "test-key",
      OPENAI_IMAGE_ANALYSIS_MODEL: "image-model",
    })).toThrowError("openai_evaluation_environment_unavailable");

    expect(requireOpenAIEvaluationEnvironment({
      OPENAI_API_KEY: "test-key",
      OPENAI_IMAGE_ANALYSIS_MODEL: "image-model",
      OPENAI_MODEL: "text-model",
    })).toEqual({ apiKey: "test-key", imageModel: "image-model", textModel: "text-model" });
  });

  it("keeps the production image and text models separate in real mode", () => {
    const providers = createOpenAIEvaluationProviders({
      apiKey: "test-key",
      imageModel: "image-model",
      textModel: "text-model",
    });

    expect(providers.visionProvider.model).toBe("image-model");
    expect(providers.textProvider.model).toBe("text-model");
  });

  it("builds the unchanged production text prompt with additive visual context", async () => {
    const dataset = await loadImageEvaluationDataset({ fixturePath, manifestPath });
    const item = dataset.cases.find((candidate) => candidate.id === "classification-01")!;
    const providers = createDeterministicImageEvaluationProviders();
    let visualSummary = "";
    let observedPrompt: unknown;
    const visionProvider: EvaluationVisionProvider = {
      ...providers.visionProvider,
      async analyze(request) {
        const result = await providers.visionProvider.analyze(request);
        visualSummary = result.analysis.safeSummary;
        return result;
      },
    };
    const textProvider: EvaluationTextProvider = {
      ...providers.textProvider,
      async generate(request) {
        observedPrompt = (request as unknown as { prompt: unknown }).prompt;
        return providers.textProvider.generate(request);
      },
    };

    await evaluateReplyAssistantImageCases({
      dataset: { ...dataset, cases: [item] },
      visionProvider,
      textProvider,
    });

    const gate = evaluatePolicyGate({ message: item.customerText, knowledge: compiledKnowledge });
    const sources = retrieveKnowledge({ gate, knowledge: compiledKnowledge });
    expect(observedPrompt).toEqual(buildDraftPrompt({
      intent: gate.intent,
      context: [item.customerText],
      rules: sources.rules,
      examples: sources.examples,
      goldenExamples: sources.goldenExamples,
      qualityGuide: sources.qualityGuide,
      toneGuide: compiledKnowledge.toneGuide,
      visualAssessment: visualSummary,
    }));
  });

  it("runs the unchanged production text validator and additive image validator", async () => {
    const dataset = await loadImageEvaluationDataset({ fixturePath, manifestPath });
    const selected = dataset.cases.filter((item) => (
      item.id === "classification-01" || item.id === "classification-02"
    ));
    const providers = createDeterministicImageEvaluationProviders();
    const textProvider: EvaluationTextProvider = {
      ...providers.textProvider,
      async generate(request) {
        return {
          draft: request.caseId === "classification-01"
            ? "As an AI assistant, this is a design reference for review."
            : "This image will print perfectly.",
          usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, costMicrousd: 0, latencyMs: 1 },
        };
      },
    };
    const report = await evaluateReplyAssistantImageCases({
      dataset: { ...dataset, cases: selected },
      visionProvider: providers.visionProvider,
      textProvider,
    });

    expect(report.results.find((item) => item.id === "classification-01")).toMatchObject({
      outputAccepted: false,
      policyViolations: expect.arrayContaining(["ai_style"]),
    });
    expect(report.results.find((item) => item.id === "classification-02")).toMatchObject({
      outputAccepted: false,
      policyViolations: expect.arrayContaining(["visual_print_suitability_claim"]),
    });
  });

  it("keeps customer assets isolated and writes a redacted 0600 report", async () => {
    const dataset = await loadImageEvaluationDataset({ fixturePath, manifestPath });
    const providers = createDeterministicImageEvaluationProviders();
    const seenAssets = new Map<string, string[]>();
    const visionProvider: EvaluationVisionProvider = {
      ...providers.visionProvider,
      analyze: vi.fn(async (request: EvaluationVisionRequest) => {
        seenAssets.set(request.caseId, request.assets.map((asset) => asset.assetId));
        return providers.visionProvider.analyze(request);
      }),
    };
    const report = await evaluateReplyAssistantImageCases({
      dataset,
      visionProvider,
      textProvider: providers.textProvider,
    });
    const outputPath = join(mkdtempSync(join(tmpdir(), "image-eval-")), "report.json");

    writeImageEvaluationReport(outputPath, report);

    for (const [caseId, assetIds] of seenAssets) {
      expect(assetIds).toEqual(dataset.cases.find((item) => item.id === caseId)?.assetIds);
    }
    expect(statSync(outputPath).mode & 0o777).toBe(0o600);
    const serialized = readFileSync(outputPath, "utf8");
    expect(serialized).not.toContain(resolve("src/server/customer-service/fixtures/image-evaluation-assets"));
    expect(serialized).not.toMatch(/image-evaluation-assets\//);
    expect(serialized).not.toMatch(/synthetic-customer-/);
    expect(report.summary.crossCustomerExposures).toBe(0);
    expect(report.summary.automaticSends).toBe(0);
  });

  it("reports vision and text usage, cost, and latency separately", async () => {
    const dataset = await loadImageEvaluationDataset({ fixturePath, manifestPath });
    const providers = createDeterministicImageEvaluationProviders();
    const report = await evaluateReplyAssistantImageCases({ dataset, ...providers });

    expect(report.summary.usage).toEqual({
      vision: expect.objectContaining({ attempts: expect.any(Number), networkCalls: expect.any(Number), costMicrousd: expect.any(Number) }),
      text: expect.objectContaining({ attempts: expect.any(Number), networkCalls: expect.any(Number), costMicrousd: expect.any(Number) }),
      totalCostMicrousd: expect.any(Number),
    });
    expect(report.summary.latency).toEqual({
      vision: expect.objectContaining({ p50Ms: expect.any(Number), p95Ms: expect.any(Number), p99Ms: expect.any(Number) }),
      text: expect.objectContaining({ p50Ms: expect.any(Number), p95Ms: expect.any(Number), p99Ms: expect.any(Number) }),
    });
  });

  it("records each deterministic failure control as an observed attempted call", async () => {
    const dataset = await loadImageEvaluationDataset({ fixturePath, manifestPath });
    const providers = createDeterministicImageEvaluationProviders();
    const report = await evaluateReplyAssistantImageCases({ dataset, ...providers });

    expect(report.results.find((item) => item.id === "failure-04")).toMatchObject({
      providerAttempts: { vision: true, text: false },
      networkCalls: { vision: false, text: false },
      providerFailure: "vision_timeout",
    });
    expect(report.results.find((item) => item.id === "failure-05")).toMatchObject({
      providerAttempts: { vision: true, text: false },
      networkCalls: { vision: false, text: false },
      providerFailure: "vision_invalid_output",
    });
    expect(report.results.find((item) => item.id === "failure-06")).toMatchObject({
      providerAttempts: { vision: true, text: true },
      networkCalls: { vision: false, text: false },
      providerFailure: "text_provider_error",
    });
  });

  it("measures elapsed latency around successful and failed attempts", async () => {
    const dataset = await loadImageEvaluationDataset({ fixturePath, manifestPath });
    const item = dataset.cases.find((candidate) => candidate.id === "failure-06")!;
    const providers = createDeterministicImageEvaluationProviders();
    const visionProvider: EvaluationVisionProvider = {
      ...providers.visionProvider,
      networked: false,
      async analyze(request) {
        const result = await providers.visionProvider.analyze(request);
        return { ...result, usage: { ...result.usage, latencyMs: 999 } };
      },
    };
    const textProvider: EvaluationTextProvider = {
      ...providers.textProvider,
      networked: false,
      async generate() {
        throw Object.assign(new Error("provider failed"), {
          code: "observed_text_failure",
          networkCallMade: false,
        });
      },
    };
    const timestamps = [0, 7, 10, 25];
    const report = await evaluateReplyAssistantImageCases({
      dataset: { ...dataset, cases: [item] },
      visionProvider,
      textProvider,
      now: () => timestamps.shift() ?? 25,
    });

    expect(report.results[0]).toMatchObject({
      providerFailure: "observed_text_failure",
      observedLatencyMs: { vision: 7, text: 15 },
    });
    expect(report.summary.latency.vision.p50Ms).toBe(7);
    expect(report.summary.latency.text.p50Ms).toBe(15);
  });
});
