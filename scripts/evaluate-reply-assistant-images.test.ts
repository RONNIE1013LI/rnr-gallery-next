import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createDeterministicImageEvaluationProviders,
  evaluateReplyAssistantImageCases,
  loadImageEvaluationDataset,
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

  it("makes zero vision and text calls for blocked policy controls", async () => {
    const dataset = await loadImageEvaluationDataset({ fixturePath, manifestPath });
    const visionProvider: EvaluationVisionProvider = {
      kind: "mock",
      model: "must-not-run",
      analyze: vi.fn(async () => { throw new Error("unexpected_vision_call"); }),
    };
    const textProvider: EvaluationTextProvider = {
      kind: "mock",
      model: "must-not-run",
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
    expect(report.summary.blockedProviderCalls).toEqual({ vision: 0, text: 0, total: 0 });
    expect(report.summary.gateBypasses).toBe(0);
  });

  it("runs all 80 deterministic mock cases with zero privacy and policy failures", async () => {
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
      blockedProviderCalls: { vision: 0, text: 0, total: 0 },
      inputFailures: 3,
      visionProviderFailures: 2,
      textProviderFailures: 1,
      classificationAccuracyPct: 100,
      comparisonAccuracyPct: 100,
      gatePassed: true,
    });
    expect(report.summary.visualIssueCoveragePct).toBeGreaterThanOrEqual(90);
    expect(report.summary.requestOriginalRecallPct).toBeGreaterThanOrEqual(90);
    expect(report.summary.assistedAcceptancePct).toBeGreaterThanOrEqual(95);
    expect(report.results).toHaveLength(80);
    expect(report.results.every((result) => result.assetIds.every((assetId) => !assetId.includes("/")))).toBe(true);
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
    expect(report.results[0]).toMatchObject({ gateBypass: true, providerCalls: { vision: true, text: true } });
  });

  it("calculates original-file recall from recommendations, not issue codes alone", async () => {
    const dataset = await loadImageEvaluationDataset({ fixturePath, manifestPath });
    const screenshot = dataset.cases.find((item) => item.category === "screenshot_original")!;
    const providers = createDeterministicImageEvaluationProviders();
    const visionProvider: EvaluationVisionProvider = {
      ...providers.visionProvider,
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
      textProvider: providers.textProvider,
    });

    expect(report.summary.requestOriginalRecallPct).toBe(0);
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
      vision: expect.objectContaining({ calls: expect.any(Number), costMicrousd: expect.any(Number) }),
      text: expect.objectContaining({ calls: expect.any(Number), costMicrousd: expect.any(Number) }),
      totalCostMicrousd: expect.any(Number),
    });
    expect(report.summary.latency).toEqual({
      vision: expect.objectContaining({ p50Ms: expect.any(Number), p95Ms: expect.any(Number), p99Ms: expect.any(Number) }),
      text: expect.objectContaining({ p50Ms: expect.any(Number), p95Ms: expect.any(Number), p99Ms: expect.any(Number) }),
    });
  });
});
