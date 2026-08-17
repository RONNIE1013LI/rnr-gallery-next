import { createHash } from "node:crypto";
import { chmodSync, lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import compiledKnowledge from "../src/server/customer-service/knowledge/compiled-knowledge.json";
import { validateImageAttachment } from "../src/server/customer-service/attachments/image-validation";
import { IMAGE_LIMITS } from "../src/server/customer-service/attachments/limits";
import {
  parseImageAnalysisResult,
  renderImageAnalysisSafeSummary,
  type ImageAnalysisResult,
} from "../src/server/customer-service/image-analysis-schema";
import { validateImageDraft } from "../src/server/customer-service/image-draft-validator";
import { validateDraft } from "../src/server/customer-service/output-validator";
import { buildDraftPrompt } from "../src/server/customer-service/prompt-builder";
import { retrieveKnowledge } from "../src/server/customer-service/knowledge-retrieval";
import { evaluatePolicyGate } from "../src/server/customer-service/policy-gate";
import type { AiProviderRequest } from "../src/server/customer-service/providers/ai-provider";
import { OpenAIImageAnalysisProvider } from "../src/server/customer-service/providers/openai-image-analysis";
import { OpenAIResponsesProvider } from "../src/server/customer-service/providers/openai-responses";
import { pricingForReviewedImageModel, type ModelPricing } from "../src/server/customer-service/usage-cost";

const CATEGORIES = [
  "blur_low_resolution",
  "screenshot_original",
  "small_subject",
  "heavy_crop",
  "obstruction",
  "classification",
  "comparison",
  "blocked_policy",
  "provider_input_failure",
] as const;

const REQUIRED_DISTRIBUTION: Readonly<Record<typeof CATEGORIES[number], number>> = Object.freeze({
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

const FailureModeSchema = z.enum([
  "malformed_input",
  "unsupported_input",
  "oversized_input",
  "vision_timeout",
  "vision_invalid_output",
  "text_provider_error",
]).nullable();

const EvaluationCaseSchema = z.object({
  id: z.string().min(1),
  category: z.enum(CATEGORIES),
  syntheticConversationKey: z.string().regex(/^synthetic-customer-[a-z0-9-]+$/),
  customerText: z.string().min(1),
  assetIds: z.array(z.string().regex(/^asset-[a-z0-9-]+$/)).min(1).max(5),
  expectedGateDecision: z.enum(["DRAFT_ALLOWED", "NEEDS_HUMAN_REVIEW", "REALTIME_DATA_REQUIRED"]),
  expected: z.object({
    classifications: z.array(z.enum([
      "customer_photo",
      "design_reference",
      "screenshot_of_photo",
      "screenshot_of_design",
      "price_or_ad_reference",
      "unknown",
    ])),
    issueCodes: z.array(z.enum([
      "request_original",
      "request_uncropped",
      "request_closer_subject",
      "request_less_obstructed",
      "request_alternative",
      "manual_assessment",
    ])),
    acceptableRecommendationCodes: z.array(z.enum([
      "send_original_file",
      "send_uncropped_version",
      "send_closer_photo",
      "send_alternative_photo",
      "use_as_main_candidate",
      "use_as_side_candidate",
      "human_review",
    ])).min(1),
    likelyMainOrdinal: z.number().int().nonnegative().nullable(),
    requiredDraftPoints: z.array(z.string().min(1)),
    forbiddenClaims: z.array(z.string().min(1)),
    fallback: z.enum(["human_review"]).nullable(),
  }).strict(),
  failureMode: FailureModeSchema,
}).strict().superRefine((item, context) => {
  if (item.expected.classifications.length !== item.assetIds.length) {
    context.addIssue({ code: "custom", message: "classification_count_mismatch" });
  }
});

const ManifestAssetSchema = z.object({
  assetId: z.string().regex(/^asset-[a-z0-9-]+$/),
  relativePath: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  provenanceCategory: z.literal("deterministic_realistic_synthetic"),
  consentStatus: z.literal("not_applicable_generated"),
  permittedUse: z.literal("internal_reply_assistant_image_evaluation"),
  pixelContent: z.literal("label_free_synthetic_scene"),
  mimeType: z.string().min(1),
}).strict();

const ManifestSchema = z.object({
  schemaVersion: z.literal("1"),
  generatedAt: z.string().datetime(),
  generator: z.string().min(1),
  assets: z.array(ManifestAssetSchema).min(1),
}).strict();

export type ImageEvaluationCase = z.infer<typeof EvaluationCaseSchema>;
type ManifestAsset = z.infer<typeof ManifestAssetSchema>;
type ImageEvaluationManifest = z.infer<typeof ManifestSchema>;

type LoadedAsset = Readonly<{
  assetId: string;
  bytes: Buffer;
  mimeType: string;
}>;

export type ImageEvaluationDataset = Readonly<{
  cases: readonly ImageEvaluationCase[];
  manifest: ImageEvaluationManifest;
  distribution: Readonly<Record<typeof CATEGORIES[number], number>>;
  assets: ReadonlyMap<string, LoadedAsset>;
  assetOwners: ReadonlyMap<string, string>;
}>;

type ProviderUsage = Readonly<{
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costMicrousd: number | null;
  latencyMs: number;
}>;

export type EvaluationVisionRequest = Readonly<{
  caseId: string;
  failureMode: z.infer<typeof FailureModeSchema>;
  assets: ReadonlyArray<Readonly<{
    bytes: Buffer;
    mimeType: string;
    ordinal: number;
  }>>;
}>;

export type EvaluationVisionProvider = Readonly<{
  kind: "mock" | "openai";
  model: string;
  networked: boolean;
  analyze(request: EvaluationVisionRequest): Promise<Readonly<{
    analysis: ImageAnalysisResult;
    usage: ProviderUsage;
  }>>;
}>;

export type EvaluationTextRequest = Readonly<{
  caseId: string;
  failureMode: z.infer<typeof FailureModeSchema>;
  prompt: AiProviderRequest;
}>;

export type EvaluationTextProvider = Readonly<{
  kind: "mock" | "openai";
  model: string;
  networked: boolean;
  generate(request: EvaluationTextRequest): Promise<Readonly<{
    draft: string;
    usage: ProviderUsage;
  }>>;
}>;

type CaseResult = Readonly<{
  id: string;
  category: ImageEvaluationCase["category"];
  assetIds: readonly string[];
  gateResult: string;
  expectedGateResult: string;
  gateBypass: boolean;
  classifications: readonly string[];
  visualCodes: readonly string[];
  recommendationCodes: readonly string[];
  likelyMainOrdinal: number | null;
  draft: string;
  outputAccepted: boolean;
  policyViolations: readonly string[];
  requiredPointCoveragePct: number | null;
  providerAttempts: Readonly<{ vision: boolean; text: boolean }>;
  networkCalls: Readonly<{ vision: boolean; text: boolean }>;
  observedLatencyMs: Readonly<{ vision: number; text: number }>;
  usage: Readonly<{ vision: ProviderUsage; text: ProviderUsage }>;
  inputFailure: string | null;
  providerFailure: string | null;
  providerFailureStage: "vision" | "text" | null;
  humanReviewRequired: true;
  crossCustomerExposure: boolean;
  automaticSend: false;
  expectationScores: Readonly<{
    gate: boolean;
    classifications: boolean | null;
    issueCodes: boolean | null;
    recommendation: boolean | null;
    likelyMainOrdinal: boolean | null;
    requiredDraftPointsPct: number | null;
    forbiddenClaims: boolean;
    forbiddenClaimMatches: readonly string[];
    fallback: boolean | null;
  }>;
}>;

export const AUTOMATED_IMAGE_QUALITY_THRESHOLDS = Object.freeze({
  visualIssueCoveragePct: 90,
  requestOriginalRecallPct: 90,
  forbiddenClaimMatches: 0,
} as const);

export function automatedImageQualityGate(input: Readonly<{
  harnessGatePassed: boolean;
  visualIssueCoveragePct: number;
  requestOriginalRecallPct: number;
  forbiddenClaimMatches: number;
}>) {
  return input.harnessGatePassed
    && input.visualIssueCoveragePct >= AUTOMATED_IMAGE_QUALITY_THRESHOLDS.visualIssueCoveragePct
    && input.requestOriginalRecallPct >= AUTOMATED_IMAGE_QUALITY_THRESHOLDS.requestOriginalRecallPct
    && input.forbiddenClaimMatches <= AUTOMATED_IMAGE_QUALITY_THRESHOLDS.forbiddenClaimMatches;
}

const ZERO_USAGE: ProviderUsage = Object.freeze({
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  costMicrousd: 0,
  latencyMs: 0,
});

function percentage(numerator: number, denominator: number) {
  return denominator ? Math.round((numerator / denominator) * 10_000) / 100 : 0;
}

function percentile(values: readonly number[], quantile: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(quantile * sorted.length) - 1] ?? 0;
}

function latencySummary(values: readonly number[]) {
  return {
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    p99Ms: percentile(values, 0.99),
    maxMs: Math.max(0, ...values),
  };
}

function hasDuplicate(values: readonly string[]) {
  return new Set(values).size !== values.length;
}

function outsideBase(basePath: string, candidatePath: string) {
  const pathFromBase = relative(basePath, candidatePath);
  return pathFromBase === ".." || isAbsolute(pathFromBase) || pathFromBase.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`);
}

function safeAssetPath(basePath: string, canonicalBasePath: string, asset: ManifestAsset) {
  if (isAbsolute(asset.relativePath) || asset.relativePath.split(/[\\/]/).includes("..")) {
    throw new Error("image_evaluation_unsafe_asset_path");
  }
  const candidate = resolve(basePath, asset.relativePath);
  if (outsideBase(basePath, candidate)) throw new Error("image_evaluation_unsafe_asset_path");
  let status;
  let canonicalCandidate;
  try {
    status = lstatSync(candidate);
    canonicalCandidate = realpathSync(candidate);
  } catch {
    throw new Error("image_evaluation_unsafe_asset_path");
  }
  if (!status.isFile() || status.isSymbolicLink() || outsideBase(canonicalBasePath, canonicalCandidate)) {
    throw new Error("image_evaluation_unsafe_asset_path");
  }
  return canonicalCandidate;
}

export async function loadImageEvaluationDataset({
  fixturePath,
  manifestPath,
}: Readonly<{ fixturePath: string; manifestPath: string }>): Promise<ImageEvaluationDataset> {
  const cases = readFileSync(fixturePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => EvaluationCaseSchema.parse(JSON.parse(line)));
  const manifest = ManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
  if (hasDuplicate(cases.map((item) => item.id)) || hasDuplicate(manifest.assets.map((item) => item.assetId))) {
    throw new Error("image_evaluation_duplicate_id");
  }

  const distribution = Object.fromEntries(CATEGORIES.map((category) => [
    category,
    cases.filter((item) => item.category === category).length,
  ])) as Record<typeof CATEGORIES[number], number>;
  if (cases.length !== 80 || CATEGORIES.some((category) => distribution[category] !== REQUIRED_DISTRIBUTION[category])) {
    throw new Error("image_evaluation_distribution_mismatch");
  }

  const referencedAssets = cases.flatMap((item) => item.assetIds);
  if (hasDuplicate(referencedAssets) || referencedAssets.length !== manifest.assets.length) {
    throw new Error("image_evaluation_asset_ownership_mismatch");
  }
  const assetDirectory = dirname(manifestPath);
  const canonicalAssetDirectory = realpathSync(assetDirectory);
  const assets = new Map<string, LoadedAsset>();
  for (const asset of manifest.assets) {
    const bytes = readFileSync(safeAssetPath(assetDirectory, canonicalAssetDirectory, asset));
    if (createHash("sha256").update(bytes).digest("hex") !== asset.sha256) {
      throw new Error("image_evaluation_asset_hash_mismatch");
    }
    assets.set(asset.assetId, { assetId: asset.assetId, bytes, mimeType: asset.mimeType });
  }
  if (referencedAssets.some((assetId) => !assets.has(assetId))) {
    throw new Error("image_evaluation_asset_missing");
  }

  const assetOwners = new Map<string, string>();
  for (const item of cases) {
    for (const assetId of item.assetIds) assetOwners.set(assetId, item.syntheticConversationKey);
  }
  return { cases, manifest, distribution, assets, assetOwners };
}

function mockImageRecord(ordinal: number): ImageAnalysisResult["images"][number] {
  return {
    ordinal,
    classification: "unknown",
    blur: "unclear",
    sourceResolutionSignal: "unclear",
    subjectScale: "unclear",
    crop: "unclear",
    obstruction: "unclear",
    screenshotSignal: "unclear",
    recommendedRole: "unclear",
    issueCodes: ["manual_assessment"],
  };
}

function mockAnalysis(request: EvaluationVisionRequest) {
  const draft = {
    schemaVersion: "1" as const,
    overallStatus: "assessed" as const,
    images: request.assets.map((asset) => mockImageRecord(asset.ordinal)),
    comparison: null,
    recommendationCodes: ["human_review" as const],
    safeSummary: "",
  };
  return parseImageAnalysisResult(
    { ...draft, safeSummary: renderImageAnalysisSafeSummary(draft) },
    request.assets.map((asset) => asset.ordinal),
  );
}

export function createDeterministicImageEvaluationProviders(): Readonly<{
  visionProvider: EvaluationVisionProvider;
  textProvider: EvaluationTextProvider;
}> {
  return {
    visionProvider: {
      kind: "mock",
      model: "deterministic-image-evaluation-v1",
      networked: false,
      async analyze(request) {
        if (request.failureMode === "vision_timeout") throw new Error("vision_timeout");
        if (request.failureMode === "vision_invalid_output") throw new Error("vision_invalid_output");
        return {
          analysis: mockAnalysis(request),
          usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, costMicrousd: 0, latencyMs: 0 },
        };
      },
    },
    textProvider: {
      kind: "mock",
      model: "deterministic-text-evaluation-v1",
      networked: false,
      async generate(request) {
        if (request.failureMode === "text_provider_error") throw new Error("text_provider_error");
        return {
          draft: "Please review the original image file before preparing a customer reply.",
          usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, costMicrousd: 0, latencyMs: 0 },
        };
      },
    },
  };
}

export function createOpenAIEvaluationProviders({
  apiKey,
  imageModel,
  textModel,
  imagePricing,
}: Readonly<{ apiKey: string; imageModel: string; textModel: string; imagePricing?: ModelPricing }>) {
  const vision = new OpenAIImageAnalysisProvider({ apiKey, model: imageModel, pricing: imagePricing });
  const text = new OpenAIResponsesProvider({ apiKey, model: textModel });
  const visionProvider: EvaluationVisionProvider = {
    kind: "openai",
    model: imageModel,
    networked: true,
    async analyze(request) {
      if (request.failureMode === "vision_timeout") {
        throw Object.assign(new Error("vision_timeout"), { code: "vision_timeout", networkCallMade: false });
      }
      if (request.failureMode === "vision_invalid_output") {
        throw Object.assign(new Error("vision_invalid_output"), { code: "vision_invalid_output", networkCallMade: false });
      }
      const result = await vision.analyze({
        images: request.assets.map((asset) => ({
          ordinal: asset.ordinal,
          mimeType: asset.mimeType as "image/jpeg" | "image/png" | "image/webp",
          bytes: asset.bytes,
        })),
      });
      return {
        analysis: result.analysis,
        usage: { ...result.usage, costMicrousd: result.estimatedCostMicrousd, latencyMs: result.latencyMs },
      };
    },
  };
  const textProvider: EvaluationTextProvider = {
    kind: "openai",
    model: textModel,
    networked: true,
    async generate(request) {
      if (request.failureMode === "text_provider_error") {
        throw Object.assign(new Error("text_provider_error"), { code: "text_provider_error", networkCallMade: false });
      }
      const result = await text.generate(request.prompt);
      return {
        draft: result.text,
        usage: { ...result.usage, costMicrousd: result.estimatedCostMicrousd, latencyMs: result.latencyMs },
      };
    },
  };
  return { visionProvider, textProvider };
}

export function scoreImageEvaluationExpectations(input: Readonly<{
  expectedGateDecision: ImageEvaluationCase["expectedGateDecision"];
  expected: ImageEvaluationCase["expected"];
  gateResult: string;
  visualObserved: boolean;
  draftObserved: boolean;
  classifications: readonly string[];
  visualCodes: readonly string[];
  recommendationCodes: readonly string[];
  likelyMainOrdinal: number | null;
  draft: string;
  fallbackObserved: boolean;
}>): CaseResult["expectationScores"] {
  const forbiddenClaimMatches = input.expected.forbiddenClaims.filter((claim) => (
    input.draft.toLowerCase().includes(claim.toLowerCase())
  ));
  return {
    gate: input.gateResult === input.expectedGateDecision,
    classifications: input.visualObserved
      ? input.classifications.length === input.expected.classifications.length
        && input.classifications.every((classification, index) => classification === input.expected.classifications[index])
      : null,
    issueCodes: input.visualObserved
      ? input.visualCodes.length === input.expected.issueCodes.length
        && input.visualCodes.every((code) => input.expected.issueCodes.includes(code as never))
      : null,
    recommendation: input.visualObserved
      ? input.expected.acceptableRecommendationCodes.some((code) => input.recommendationCodes.includes(code))
      : null,
    likelyMainOrdinal: input.visualObserved
      ? input.likelyMainOrdinal === input.expected.likelyMainOrdinal
      : null,
    requiredDraftPointsPct: input.draftObserved
      ? requiredPointCoverage(input.draft, input.expected.requiredDraftPoints)
      : null,
    forbiddenClaims: forbiddenClaimMatches.length === 0,
    forbiddenClaimMatches,
    fallback: input.expected.fallback === null ? null : input.fallbackObserved,
  };
}

function failedResult(item: ImageEvaluationCase, input: Partial<CaseResult>): CaseResult {
  const classifications = input.classifications ?? [];
  const visualCodes = input.visualCodes ?? [];
  const recommendationCodes = input.recommendationCodes ?? [];
  const likelyMainOrdinal = input.likelyMainOrdinal ?? null;
  const draft = input.draft ?? "";
  const providerAttempts = input.providerAttempts ?? { vision: false, text: false };
  const providerFailureStage = input.providerFailureStage ?? null;
  const inputFailure = input.inputFailure ?? null;
  const visualObserved = providerAttempts.vision && providerFailureStage !== "vision" && !inputFailure;
  const draftObserved = providerAttempts.text && providerFailureStage !== "text";
  const scores = scoreImageEvaluationExpectations({
    expectedGateDecision: item.expectedGateDecision,
    expected: item.expected,
    gateResult: input.gateResult ?? item.expectedGateDecision,
    visualObserved,
    draftObserved,
    classifications,
    visualCodes,
    recommendationCodes,
    likelyMainOrdinal,
    draft,
    fallbackObserved: Boolean(
      inputFailure
      || providerFailureStage
      || input.gateResult && input.gateResult !== "DRAFT_ALLOWED"
      || input.outputAccepted === false,
    ),
  });
  const reportedRequiredPointCoverage = Object.prototype.hasOwnProperty.call(input, "requiredPointCoveragePct")
    ? input.requiredPointCoveragePct ?? null
    : scores.requiredDraftPointsPct;
  return {
    id: item.id,
    category: item.category,
    assetIds: item.assetIds,
    gateResult: input.gateResult ?? item.expectedGateDecision,
    expectedGateResult: item.expectedGateDecision,
    gateBypass: input.gateBypass ?? false,
    classifications,
    visualCodes,
    recommendationCodes,
    likelyMainOrdinal,
    draft,
    outputAccepted: input.outputAccepted ?? false,
    policyViolations: input.policyViolations ?? [],
    requiredPointCoveragePct: reportedRequiredPointCoverage,
    providerAttempts,
    networkCalls: input.networkCalls ?? { vision: false, text: false },
    observedLatencyMs: input.observedLatencyMs ?? { vision: 0, text: 0 },
    usage: input.usage ?? { vision: ZERO_USAGE, text: ZERO_USAGE },
    inputFailure,
    providerFailure: input.providerFailure ?? null,
    providerFailureStage,
    humanReviewRequired: true,
    crossCustomerExposure: input.crossCustomerExposure ?? false,
    automaticSend: false,
    expectationScores: { ...scores, requiredDraftPointsPct: reportedRequiredPointCoverage },
  };
}

async function validateCaseAssets(item: ImageEvaluationCase, assets: readonly LoadedAsset[]) {
  if (assets.length > IMAGE_LIMITS.maxCount) throw new Error("image_input_rejected");
  let batchBytes = 0;
  for (const asset of assets) {
    batchBytes += asset.bytes.byteLength;
    if (asset.bytes.byteLength > IMAGE_LIMITS.maxBytesPerImage || batchBytes > IMAGE_LIMITS.maxBatchBytes) {
      throw new Error("image_input_rejected");
    }
    await validateImageAttachment(asset.bytes, asset.mimeType);
  }
  if (!item.assetIds.every((assetId, index) => assets[index]?.assetId === assetId)) {
    throw new Error("image_context_mismatch");
  }
}

function requiredPointCoverage(draft: string, requiredPoints: readonly string[]) {
  const value = draft.toLowerCase();
  const covered = requiredPoints.filter((point) => value.includes(point.toLowerCase())).length;
  return percentage(covered, requiredPoints.length);
}

function aggregateUsage(results: readonly CaseResult[], kind: "vision" | "text") {
  const values = results.map((result) => result.usage[kind]);
  return {
    attempts: results.filter((result) => result.providerAttempts[kind]).length,
    networkCalls: results.filter((result) => result.networkCalls[kind]).length,
    successfulCalls: results.filter((result) => (
      result.providerAttempts[kind] && result.providerFailureStage !== kind
    )).length,
    inputTokens: values.reduce((sum, item) => sum + item.inputTokens, 0),
    cachedInputTokens: values.reduce((sum, item) => sum + item.cachedInputTokens, 0),
    outputTokens: values.reduce((sum, item) => sum + item.outputTokens, 0),
    costMicrousd: values.some((item) => item.costMicrousd === null)
      ? null
      : values.reduce((sum, item) => sum + (item.costMicrousd ?? 0), 0),
  };
}

function elapsed(startedAt: number, endedAt: number) {
  return Math.max(0, endedAt - startedAt);
}

function observedProviderFailure(
  error: unknown,
  fallbackCode: string,
  providerNetworked: boolean,
) {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const candidate = typeof value.code === "string"
    ? value.code
    : error instanceof Error
      ? error.message
      : "";
  const code = /^[a-z][a-z0-9_]{0,63}$/.test(candidate) ? candidate : fallbackCode;
  return {
    code,
    networkCallMade: typeof value.networkCallMade === "boolean"
      ? value.networkCallMade
      : providerNetworked,
  };
}

export async function evaluateReplyAssistantImageCases({
  dataset,
  visionProvider,
  textProvider,
  now = () => performance.now(),
}: Readonly<{
  dataset: ImageEvaluationDataset;
  visionProvider: EvaluationVisionProvider;
  textProvider: EvaluationTextProvider;
  now?: () => number;
}>) {
  const results: CaseResult[] = [];
  const qualityObserved = visionProvider.kind === "openai" && textProvider.kind === "openai";

  for (const item of dataset.cases) {
    const gate = evaluatePolicyGate({ message: item.customerText, knowledge: compiledKnowledge });
    if (!gate.providerAllowed) {
      results.push(failedResult(item, {
        gateResult: gate.decision,
        gateBypass: false,
      }));
      continue;
    }
    const gateBypass = item.expectedGateDecision !== "DRAFT_ALLOWED";

    const loadedAssets = item.assetIds.map((assetId) => dataset.assets.get(assetId)).filter((asset): asset is LoadedAsset => Boolean(asset));
    const crossCustomerExposure = item.assetIds.some((assetId) => (
      dataset.assetOwners.get(assetId) !== item.syntheticConversationKey
    ));
    if (crossCustomerExposure || loadedAssets.length !== item.assetIds.length) {
      results.push(failedResult(item, {
        gateResult: gate.decision,
        gateBypass,
        crossCustomerExposure,
        inputFailure: "image_context_mismatch",
      }));
      continue;
    }

    try {
      await validateCaseAssets(item, loadedAssets);
    } catch {
      results.push(failedResult(item, {
        gateResult: gate.decision,
        gateBypass,
        inputFailure: "image_input_rejected",
      }));
      continue;
    }

    let visionResult: Awaited<ReturnType<EvaluationVisionProvider["analyze"]>>;
    const visionStartedAt = now();
    let visionLatencyMs: number;
    try {
      visionResult = await visionProvider.analyze({
        caseId: item.id,
        failureMode: item.failureMode,
        assets: loadedAssets.map((asset, ordinal) => ({
          bytes: asset.bytes,
          mimeType: asset.mimeType,
          ordinal,
        })),
      });
      visionLatencyMs = elapsed(visionStartedAt, now());
      visionResult = {
        ...visionResult,
        usage: { ...visionResult.usage, latencyMs: visionLatencyMs },
        analysis: parseImageAnalysisResult(visionResult.analysis, loadedAssets.map((_, ordinal) => ordinal)),
      };
    } catch (error) {
      visionLatencyMs = elapsed(visionStartedAt, now());
      const failure = observedProviderFailure(error, "vision_provider_error", visionProvider.networked);
      results.push(failedResult(item, {
        gateResult: gate.decision,
        gateBypass,
        providerAttempts: { vision: true, text: false },
        networkCalls: { vision: failure.networkCallMade, text: false },
        observedLatencyMs: { vision: visionLatencyMs, text: 0 },
        usage: { vision: { ...ZERO_USAGE, latencyMs: visionLatencyMs }, text: ZERO_USAGE },
        providerFailure: failure.code,
        providerFailureStage: "vision",
      }));
      continue;
    }

    const visualCodes = [...new Set(visionResult.analysis.images.flatMap((image) => image.issueCodes))];
    const classifications = visionResult.analysis.images.map((image) => image.classification);
    const recommendationCodes = visionResult.analysis.recommendationCodes;
    const likelyMainOrdinal = visionResult.analysis.comparison?.likelyMainOrdinal ?? null;
    const sources = retrieveKnowledge({ gate, knowledge: compiledKnowledge });
    const prompt = buildDraftPrompt({
      intent: gate.intent,
      context: [item.customerText],
      rules: sources.rules,
      examples: sources.examples,
      goldenExamples: sources.goldenExamples,
      qualityGuide: sources.qualityGuide,
      toneGuide: compiledKnowledge.toneGuide,
      visualAssessment: visionResult.analysis.safeSummary,
    });
    let textResult: Awaited<ReturnType<EvaluationTextProvider["generate"]>>;
    const textStartedAt = now();
    let textLatencyMs: number;
    try {
      textResult = await textProvider.generate({
        caseId: item.id,
        failureMode: item.failureMode,
        prompt,
      });
      textLatencyMs = elapsed(textStartedAt, now());
      textResult = {
        ...textResult,
        usage: { ...textResult.usage, latencyMs: textLatencyMs },
      };
    } catch (error) {
      textLatencyMs = elapsed(textStartedAt, now());
      const failure = observedProviderFailure(error, "text_provider_error", textProvider.networked);
      results.push(failedResult(item, {
        gateResult: gate.decision,
        gateBypass,
        classifications,
        visualCodes,
        recommendationCodes,
        likelyMainOrdinal,
        providerAttempts: { vision: true, text: true },
        networkCalls: { vision: visionProvider.networked, text: failure.networkCallMade },
        observedLatencyMs: { vision: visionLatencyMs, text: textLatencyMs },
        usage: { vision: visionResult.usage, text: { ...ZERO_USAGE, latencyMs: textLatencyMs } },
        providerFailure: failure.code,
        providerFailureStage: "text",
      }));
      continue;
    }

    const textValidation = validateDraft(textResult.draft, { intent: gate.intent });
    const imageValidation = validateImageDraft(textResult.draft);
    const policyViolations = [...new Set([...textValidation.codes, ...imageValidation.codes])];
    results.push(failedResult(item, {
      gateResult: gate.decision,
      gateBypass,
      classifications,
      visualCodes,
      recommendationCodes,
      likelyMainOrdinal,
      draft: textResult.draft,
      outputAccepted: textValidation.ok && imageValidation.ok,
      policyViolations,
      requiredPointCoveragePct: qualityObserved
        ? requiredPointCoverage(textResult.draft, item.expected.requiredDraftPoints)
        : null,
      providerAttempts: { vision: true, text: true },
      networkCalls: { vision: visionProvider.networked, text: textProvider.networked },
      observedLatencyMs: { vision: visionLatencyMs, text: textLatencyMs },
      usage: { vision: visionResult.usage, text: textResult.usage },
    }));
  }

  const issueCases = dataset.cases.filter((item) => item.expected.issueCodes.length > 0);
  const expectedIssueCount = issueCases.reduce((sum, item) => sum + item.expected.issueCodes.length, 0);
  const coveredIssueCount = issueCases.reduce((sum, item) => {
    const result = results.find((candidate) => candidate.id === item.id);
    return sum + item.expected.issueCodes.filter((code) => result?.visualCodes.includes(code)).length;
  }, 0);
  const originalCases = dataset.cases.filter((item) => (
    item.category === "blur_low_resolution" || item.category === "screenshot_original"
  ));
  const originalRecall = originalCases.filter((item) => (
    results.find((result) => result.id === item.id)?.recommendationCodes.includes("send_original_file")
  )).length;
  const classificationCases = dataset.cases.filter((item) => item.category === "classification");
  const classificationMatches = classificationCases.filter((item) => {
    const actual = results.find((result) => result.id === item.id)?.classifications;
    return actual?.length === item.expected.classifications.length
      && actual.every((classification, index) => classification === item.expected.classifications[index]);
  }).length;
  const comparisonCases = dataset.cases.filter((item) => item.category === "comparison");
  const comparisonMatches = comparisonCases.filter((item) => (
    results.find((result) => result.id === item.id)?.likelyMainOrdinal === item.expected.likelyMainOrdinal
  )).length;
  const draftResults = results.filter((result) => result.providerAttempts.text && result.providerFailureStage !== "text");
  const acceptedDrafts = draftResults.filter((result) => (
    result.outputAccepted && (result.requiredPointCoveragePct ?? 0) >= 50
  ));
  const coveredDraftResults = draftResults.filter((result): result is CaseResult & { requiredPointCoveragePct: number } => (
    result.requiredPointCoveragePct !== null
  ));
  const scoredPercentage = (key: keyof CaseResult["expectationScores"]) => {
    const scores = results.flatMap((result) => {
      const value = result.expectationScores[key];
      return typeof value === "boolean" ? [value] : [];
    });
    return percentage(scores.filter(Boolean).length, scores.length);
  };
  const forbiddenClaimMatches = results.reduce(
    (sum, result) => sum + result.expectationScores.forbiddenClaimMatches.length,
    0,
  );
  const visualIssueCoveragePct = percentage(coveredIssueCount, expectedIssueCount);
  const requestOriginalRecallPct = percentage(originalRecall, originalCases.length);
  const visionUsage = aggregateUsage(results, "vision");
  const textUsage = aggregateUsage(results, "text");
  const blocked = results.filter((result) => result.expectedGateResult !== "DRAFT_ALLOWED");
  const harnessGatePassed = (
    results.length === 80
    && results.filter((result) => result.gateBypass).length === 0
    && results.reduce((sum, result) => sum + result.policyViolations.length, 0) === 0
    && forbiddenClaimMatches === 0
    && results.filter((result) => result.expectedGateResult !== "DRAFT_ALLOWED")
      .every((result) => !result.providerAttempts.vision && !result.providerAttempts.text)
    && results.every((result) => !result.crossCustomerExposure && !result.automaticSend)
    && results.filter((result) => result.inputFailure).length === 3
    && results.filter((result) => result.providerFailureStage === "vision").length === 2
    && results.filter((result) => result.providerFailureStage === "text").length === 1
  );
  const automatedQualityGatePassed = qualityObserved && automatedImageQualityGate({
    harnessGatePassed,
    visualIssueCoveragePct,
    requestOriginalRecallPct,
    forbiddenClaimMatches,
  });
  const summary = {
    totalCases: results.length,
    distribution: dataset.distribution,
    gateBypasses: results.filter((result) => result.gateBypass).length,
    policyViolations: results.reduce((sum, result) => sum + result.policyViolations.length, 0),
    rejectedUnsupportedClaims: results.filter((result) => result.policyViolations.some((code) => (
      code === "visual_restoration_claim" || code === "visual_print_suitability_claim"
    ))).length,
    forbiddenClaimMatches,
    expectationScores: {
      gateAccuracyPct: scoredPercentage("gate"),
      classificationAccuracyPct: scoredPercentage("classifications"),
      issueCodeAccuracyPct: scoredPercentage("issueCodes"),
      recommendationAccuracyPct: scoredPercentage("recommendation"),
      likelyMainAccuracyPct: scoredPercentage("likelyMainOrdinal"),
      fallbackAccuracyPct: scoredPercentage("fallback"),
    },
    blockedProviderAttempts: {
      vision: blocked.filter((result) => result.providerAttempts.vision).length,
      text: blocked.filter((result) => result.providerAttempts.text).length,
      total: blocked.reduce((sum, result) => sum + Number(result.providerAttempts.vision) + Number(result.providerAttempts.text), 0),
    },
    blockedNetworkCalls: {
      vision: blocked.filter((result) => result.networkCalls.vision).length,
      text: blocked.filter((result) => result.networkCalls.text).length,
      total: blocked.reduce((sum, result) => sum + Number(result.networkCalls.vision) + Number(result.networkCalls.text), 0),
    },
    crossCustomerExposures: results.filter((result) => result.crossCustomerExposure).length,
    automaticSends: results.filter((result) => result.automaticSend).length,
    inputFailures: results.filter((result) => result.inputFailure).length,
    visionProviderFailures: results.filter((result) => result.providerFailureStage === "vision").length,
    textProviderFailures: results.filter((result) => result.providerFailureStage === "text").length,
    quality: {
      status: qualityObserved ? "observed_human_review_pending" : "unavailable_mock_provider",
      thresholds: AUTOMATED_IMAGE_QUALITY_THRESHOLDS,
      visualIssueCoveragePct: qualityObserved ? visualIssueCoveragePct : null,
      requestOriginalRecallPct: qualityObserved ? requestOriginalRecallPct : null,
      classificationAccuracyPct: qualityObserved ? percentage(classificationMatches, classificationCases.length) : null,
      comparisonAccuracyPct: qualityObserved ? percentage(comparisonMatches, comparisonCases.length) : null,
      requiredPointCoveragePct: qualityObserved && coveredDraftResults.length
        ? Math.round(coveredDraftResults.reduce((sum, result) => sum + result.requiredPointCoveragePct, 0) / coveredDraftResults.length * 100) / 100
        : null,
      automatedDraftAcceptancePct: qualityObserved ? percentage(acceptedDrafts.length, draftResults.length) : null,
      humanAssistedAcceptancePct: null,
      humanReviewedCases: 0,
      automatedGatePassed: qualityObserved ? automatedQualityGatePassed : null,
      gatePassed: null,
    },
    usage: {
      vision: visionUsage,
      text: textUsage,
      totalCostMicrousd: visionUsage.costMicrousd === null || textUsage.costMicrousd === null
        ? null
        : visionUsage.costMicrousd + textUsage.costMicrousd,
    },
    latency: {
      vision: latencySummary(results.filter((result) => result.providerAttempts.vision).map((result) => result.observedLatencyMs.vision)),
      text: latencySummary(results.filter((result) => result.providerAttempts.text).map((result) => result.observedLatencyMs.text)),
    },
    harnessGatePassed,
    automatedQualityGatePassed: qualityObserved ? automatedQualityGatePassed : null,
    overallGatePassed: false,
  };

  return {
    schemaVersion: "1",
    provider: { vision: visionProvider.kind, text: textProvider.kind },
    models: { vision: visionProvider.model, text: textProvider.model },
    summary,
    results,
  };
}

export function writeImageEvaluationReport(outputPath: string, report: Awaited<ReturnType<typeof evaluateReplyAssistantImageCases>>) {
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  chmodSync(outputPath, 0o600);
}

function requiredArgument(name: string) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) throw new Error(`missing_argument:${name}`);
  return value;
}

export function requireOpenAIEvaluationEnvironment(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
) {
  const apiKey = env.OPENAI_API_KEY?.trim() ?? "";
  const imageModel = env.OPENAI_IMAGE_ANALYSIS_MODEL?.trim() ?? "";
  const textModel = env.OPENAI_MODEL?.trim() ?? "";
  if (!apiKey || !imageModel || !textModel) throw new Error("openai_evaluation_environment_unavailable");
  pricingForReviewedImageModel(imageModel);
  return { apiKey, imageModel, textModel };
}

export function imageEvaluationExitCode(
  providerKind: "mock" | "openai",
  summary: Readonly<{ harnessGatePassed: boolean; automatedQualityGatePassed: boolean | null }>,
) {
  return providerKind === "mock"
    ? Number(!summary.harnessGatePassed)
    : Number(!summary.harnessGatePassed || summary.automatedQualityGatePassed !== true);
}

async function runCli() {
  const fixturePath = resolve(requiredArgument("--fixture"));
  const outputPath = resolve(requiredArgument("--output"));
  const providerKind = requiredArgument("--provider");
  if (providerKind !== "mock" && providerKind !== "openai") throw new Error("invalid_provider");
  const manifestPath = resolve(dirname(fixturePath), "image-evaluation-assets/manifest.json");
  const dataset = await loadImageEvaluationDataset({ fixturePath, manifestPath });
  let providers;
  if (providerKind === "mock") {
    providers = createDeterministicImageEvaluationProviders();
  } else {
    providers = createOpenAIEvaluationProviders(requireOpenAIEvaluationEnvironment(process.env));
  }
  const report = await evaluateReplyAssistantImageCases({ dataset, ...providers });
  writeImageEvaluationReport(outputPath, report);
  process.stdout.write(`${JSON.stringify({ outputPath, summary: report.summary }, null, 2)}\n`);
  process.exitCode = imageEvaluationExitCode(providerKind, report.summary);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runCli().catch((error) => {
    const code = error instanceof Error && [
      "openai_evaluation_environment_unavailable",
      "image_analysis_model_not_approved",
    ].includes(error.message) ? error.message : "reply_assistant_image_evaluation_failed";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
}
