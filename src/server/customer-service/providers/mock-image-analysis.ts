import {
  parseImageAnalysisResult,
  renderImageAnalysisSafeSummary,
} from "../image-analysis-schema";
import type {
  ImageAnalysisProvider,
  ImageAnalysisProviderRequest,
  ImageAnalysisProviderResult,
} from "./image-analysis-provider";

export class MockImageAnalysisProvider implements ImageAnalysisProvider {
  readonly providerKind = "mock" as const;
  readonly model = "mock";

  async analyze(request: ImageAnalysisProviderRequest): Promise<ImageAnalysisProviderResult> {
    const draft = {
      schemaVersion: "1" as const,
      overallStatus: "human_review_required" as const,
      images: request.images.map((image) => ({
        ordinal: image.ordinal,
        classification: "unknown" as const,
        blur: "unclear" as const,
        sourceResolutionSignal: "unclear" as const,
        subjectScale: "unclear" as const,
        crop: "unclear" as const,
        obstruction: "unclear" as const,
        screenshotSignal: "unclear" as const,
        recommendedRole: "unclear" as const,
        issueCodes: ["manual_assessment" as const],
      })),
      comparison: null,
      recommendationCodes: ["human_review" as const],
      safeSummary: "",
    };
    const analysis = parseImageAnalysisResult(
      { ...draft, safeSummary: renderImageAnalysisSafeSummary(draft) },
      request.images.map((image) => image.ordinal),
    );

    return {
      analysis,
      provider: "mock",
      model: this.model,
      usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
      estimatedCostMicrousd: 0,
      latencyMs: 0,
    };
  }
}
