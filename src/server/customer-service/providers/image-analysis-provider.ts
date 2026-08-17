import type { ImageAnalysisResult } from "../image-analysis-schema";

export type ImageAnalysisProviderRequest = Readonly<{
  images: ReadonlyArray<Readonly<{
    ordinal: number;
    mimeType: "image/jpeg" | "image/png" | "image/webp";
    bytes: Uint8Array;
  }>>;
}>;

export type ImageAnalysisProviderResult = Readonly<{
  analysis: ImageAnalysisResult;
  provider: "mock" | "openai";
  model: string;
  usage: Readonly<{
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
  }>;
  estimatedCostMicrousd: number;
  latencyMs: number;
}>;

export interface ImageAnalysisProvider {
  readonly providerKind: "mock" | "openai";
  readonly model: string;
  analyze(request: ImageAnalysisProviderRequest): Promise<ImageAnalysisProviderResult>;
}
