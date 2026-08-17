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
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import compiledKnowledge from "../src/server/customer-service/knowledge/compiled-knowledge.json";
import { buildDraftPrompt } from "../src/server/customer-service/prompt-builder";
import { retrieveKnowledge } from "../src/server/customer-service/knowledge-retrieval";
import { evaluatePolicyGate } from "../src/server/customer-service/policy-gate";
import {
  AUTOMATED_IMAGE_QUALITY_THRESHOLDS,
  automatedImageQualityGate,
  createDeterministicImageEvaluationProviders,
  createOpenAIEvaluationProviders,
  evaluateReplyAssistantImageCases,
  imageEvaluationExitCode,
  loadImageEvaluationDataset,
  requireOpenAIEvaluationEnvironment,
  scoreImageEvaluationExpectations,
  writeImageEvaluationReport,
  type EvaluationTextProvider,
  type EvaluationVisionRequest,
  type EvaluationVisionProvider,
} from "./evaluate-reply-assistant-images";

const fixturePath = resolve("src/server/customer-service/fixtures/image-evaluation-cases.jsonl");
const manifestPath = resolve("src/server/customer-service/fixtures/image-evaluation-assets/manifest.json");

describe("reply assistant image evaluation", () => {
  it("documents realistic image quality as human-only and never satisfied by the mock harness", () => {
    const plan = readFileSync(
      resolve("docs/testing/2026-08-17-realistic-image-quality-eval.md"),
      "utf8",
    );

    expect(plan).toContain("Runtime status: HUMAN_ONLY");
    expect(plan).toContain("Realistic automated quality validation: NOT RUN");
    expect(plan).toContain("Mock 80-case result: DETERMINISTIC REGRESSION ONLY");
    for (const category of [
      "blurry portrait",
      "screenshot",
      "small face",
      "cropped face",
      "group photo",
      "low-resolution image",
      "reference banner/design",
    ]) expect(plan).toContain(category);
    expect(plan).toMatch(/approved.*real vision provider/i);
    expect(plan).toMatch(/Ronnie.*human review/i);
    expect(plan).not.toContain("Realistic automated quality validation: PASS");
  });

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
      asset.provenanceCategory === "deterministic_realistic_synthetic"
      && asset.consentStatus === "not_applicable_generated"
      && asset.permittedUse === "internal_reply_assistant_image_evaluation"
      && asset.pixelContent === "label_free_synthetic_scene"
      && /^[a-f0-9]{64}$/.test(asset.sha256)
      && !asset.relativePath.startsWith("/")
      && !asset.relativePath.includes("..")
    ))).toBe(true);
  });

  it("keeps generated image fixtures free of rendered labels and PNG text metadata", () => {
    const generatorSource = readFileSync(
      resolve("scripts/generate-reply-assistant-image-fixtures.ts"),
      "utf8",
    );
    expect(generatorSource).not.toMatch(/<text\b/i);

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      assets: Array<{ relativePath: string; mimeType: string }>;
    };
    const pngTextChunkTypes = ["tEXt", "iTXt", "zTXt"];
    for (const asset of manifest.assets.filter((item) => item.mimeType === "image/png")) {
      const bytes = readFileSync(resolve(manifestPath, "..", asset.relativePath));
      for (const chunkType of pngTextChunkTypes) {
        expect(bytes.includes(Buffer.from(chunkType, "ascii"))).toBe(false);
      }
    }
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
        expect(request.assets.every((asset: EvaluationVisionRequest["assets"][number]) => (
          !("assetId" in asset)
        ))).toBe(true);
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

    expect(() => requireOpenAIEvaluationEnvironment({
      OPENAI_API_KEY: "test-key",
      OPENAI_IMAGE_ANALYSIS_MODEL: "image-model",
      OPENAI_MODEL: "text-model",
    })).toThrowError("image_analysis_model_not_approved");
  });

  it("keeps the production image and text models separate in real mode", () => {
    const providers = createOpenAIEvaluationProviders({
      apiKey: "test-key",
      imageModel: "image-model",
      textModel: "text-model",
      imagePricing: {
        inputUsdPerMillion: 1,
        cachedInputUsdPerMillion: 0.1,
        outputUsdPerMillion: 2,
      },
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
        seenAssets.set(request.caseId, request.assets.map((asset) => (
          createHash("sha256").update(asset.bytes).digest("hex")
        )));
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

    for (const [caseId, assetHashes] of seenAssets) {
      const item = dataset.cases.find((candidate) => candidate.id === caseId)!;
      expect(assetHashes).toEqual(item.assetIds.map((assetId) => (
        createHash("sha256").update(dataset.assets.get(assetId)!.bytes).digest("hex")
      )));
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

  it("mutation-checks every declared case expectation", async () => {
    const dataset = await loadImageEvaluationDataset({ fixturePath, manifestPath });
    const item = dataset.cases.find((candidate) => candidate.id === "comparison-01")!;
    const draft = item.expected.requiredDraftPoints.join(" and ");
    const base = {
      expectedGateDecision: item.expectedGateDecision,
      expected: item.expected,
      gateResult: item.expectedGateDecision,
      visualObserved: true,
      draftObserved: true,
      classifications: item.expected.classifications,
      visualCodes: item.expected.issueCodes,
      recommendationCodes: [item.expected.acceptableRecommendationCodes[0]],
      likelyMainOrdinal: item.expected.likelyMainOrdinal,
      draft,
      fallbackObserved: false,
    } as const;
    expect(scoreImageEvaluationExpectations(base)).toMatchObject({
      gate: true,
      classifications: true,
      issueCodes: true,
      recommendation: true,
      likelyMainOrdinal: true,
      requiredDraftPointsPct: 100,
      forbiddenClaims: true,
      fallback: null,
    });
    expect(scoreImageEvaluationExpectations({ ...base, gateResult: "NEEDS_HUMAN_REVIEW" }).gate).toBe(false);
    expect(scoreImageEvaluationExpectations({
      ...base,
      classifications: ["unknown", ...base.classifications.slice(1)],
    }).classifications).toBe(false);
    expect(scoreImageEvaluationExpectations({ ...base, visualCodes: ["manual_assessment"] }).issueCodes).toBe(false);
    expect(scoreImageEvaluationExpectations({ ...base, recommendationCodes: ["human_review"] }).recommendation).toBe(false);
    expect(scoreImageEvaluationExpectations({ ...base, likelyMainOrdinal: 1 }).likelyMainOrdinal).toBe(false);
    expect(scoreImageEvaluationExpectations({ ...base, draft: "review" }).requiredDraftPointsPct).toBeLessThan(100);
    const forbidden = scoreImageEvaluationExpectations({
      ...base,
      draft: `${draft}. ${item.expected.forbiddenClaims[0]}`,
    });
    expect(forbidden.forbiddenClaims).toBe(false);
    expect(forbidden.forbiddenClaimMatches).toEqual([item.expected.forbiddenClaims[0]]);
    expect(scoreImageEvaluationExpectations({
      ...base,
      expected: { ...item.expected, fallback: "human_review" },
      fallbackObserved: false,
    }).fallback).toBe(false);
  });

  it("mutation-checks every automated quality threshold and real-mode exit boundary", () => {
    const passing = {
      harnessGatePassed: true,
      visualIssueCoveragePct: AUTOMATED_IMAGE_QUALITY_THRESHOLDS.visualIssueCoveragePct,
      requestOriginalRecallPct: AUTOMATED_IMAGE_QUALITY_THRESHOLDS.requestOriginalRecallPct,
      forbiddenClaimMatches: AUTOMATED_IMAGE_QUALITY_THRESHOLDS.forbiddenClaimMatches,
    };
    expect(automatedImageQualityGate(passing)).toBe(true);
    expect(automatedImageQualityGate({ ...passing, visualIssueCoveragePct: 89.99 })).toBe(false);
    expect(automatedImageQualityGate({ ...passing, requestOriginalRecallPct: 89.99 })).toBe(false);
    expect(automatedImageQualityGate({ ...passing, forbiddenClaimMatches: 1 })).toBe(false);
    expect(automatedImageQualityGate({ ...passing, harnessGatePassed: false })).toBe(false);
    expect(imageEvaluationExitCode("mock", { harnessGatePassed: true, automatedQualityGatePassed: null })).toBe(0);
    expect(imageEvaluationExitCode("openai", { harnessGatePassed: true, automatedQualityGatePassed: false })).toBe(1);
    expect(imageEvaluationExitCode("openai", { harnessGatePassed: true, automatedQualityGatePassed: true })).toBe(0);
  });
});
