import { z } from "zod";
import {
  ImageAnalysisTransportSchema,
  parseImageAnalysisResult,
  renderImageAnalysisSafeSummary,
} from "../image-analysis-schema";
import { estimateCostMicrousd } from "../usage-cost";
import type { ModelPricing } from "../usage-cost";
import type {
  ImageAnalysisProvider,
  ImageAnalysisProviderRequest,
  ImageAnalysisProviderResult,
} from "./image-analysis-provider";

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const ANALYSIS_INSTRUCTIONS = [
  "Assess only visible image properties using the supplied JSON schema.",
  "Do not identify people or infer age, ethnicity, health, emotion, or attractiveness.",
  "Do not estimate price, timing, restoration success, or print suitability.",
  "Use only approved enum values. Set safeSummary to an empty string; it is rendered locally.",
].join(" ");

function outputText(body: Record<string, unknown>) {
  if (typeof body.output_text === "string") return body.output_text;
  if (!Array.isArray(body.output)) return "";
  return body.output.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) return [];
    return content.flatMap((part) => {
      if (!part || typeof part !== "object") return [];
      const value = part as Record<string, unknown>;
      return value.type === "output_text" && typeof value.text === "string" ? [value.text] : [];
    });
  }).join("\n");
}

function validateRequest(request: ImageAnalysisProviderRequest) {
  if (request.images.length < 1 || request.images.length > 5) {
    throw new Error("image_analysis_invalid_request");
  }
  const ordinals = new Set<number>();
  for (const image of request.images) {
    if (!Number.isInteger(image.ordinal) || image.ordinal < 1 || image.bytes.byteLength < 1) {
      throw new Error("image_analysis_invalid_request");
    }
    if (ordinals.has(image.ordinal)) throw new Error("image_analysis_invalid_request");
    ordinals.add(image.ordinal);
  }
}

export class OpenAIImageAnalysisProvider implements ImageAnalysisProvider {
  readonly providerKind = "openai" as const;
  readonly model: string;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchImplementation;
  private readonly now: () => number;
  private readonly pricing?: ModelPricing;

  constructor({
    apiKey,
    model,
    fetchImpl = fetch,
    now = Date.now,
    pricing,
  }: Readonly<{
    apiKey: string;
    model: string;
    fetchImpl?: FetchImplementation;
    now?: () => number;
    pricing?: ModelPricing;
  }>) {
    this.apiKey = apiKey;
    this.model = model;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.pricing = pricing;
  }

  async analyze(request: ImageAnalysisProviderRequest): Promise<ImageAnalysisProviderResult> {
    if (!this.apiKey || !this.model) throw new Error("image_analysis_configuration_error");
    validateRequest(request);
    const startedAt = this.now();

    let response: Response;
    try {
      response = await this.fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          store: false,
          reasoning: { effort: "none" },
          max_output_tokens: 1_500,
          input: [{
            role: "user",
            content: [
              { type: "input_text", text: ANALYSIS_INSTRUCTIONS },
              ...request.images.map((image) => ({
                type: "input_image",
                image_url: `data:${image.mimeType};base64,${Buffer.from(image.bytes).toString("base64")}`,
                detail: "auto",
              })),
            ],
          }],
          text: {
            verbosity: "low",
            format: {
              type: "json_schema",
              name: "image_analysis_result",
              strict: true,
              schema: z.toJSONSchema(ImageAnalysisTransportSchema, { target: "draft-7" }),
            },
          },
        }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new Error("image_analysis_provider_error");
    }
    if (!response.ok) throw new Error("image_analysis_provider_error");

    let body: Record<string, unknown>;
    let rawAnalysis: unknown;
    try {
      body = await response.json() as Record<string, unknown>;
      rawAnalysis = JSON.parse(outputText(body));
    } catch {
      throw new Error("image_analysis_invalid_output");
    }

    let analysis;
    try {
      const validated = ImageAnalysisTransportSchema.parse(rawAnalysis);
      analysis = parseImageAnalysisResult(
        { ...validated, safeSummary: renderImageAnalysisSafeSummary(validated) },
        request.images.map((image) => image.ordinal),
      );
    } catch {
      throw new Error("image_analysis_invalid_output");
    }

    const usageBody = (body.usage ?? {}) as Record<string, unknown>;
    const inputDetails = (usageBody.input_tokens_details ?? {}) as Record<string, unknown>;
    const usage = {
      inputTokens: Number(usageBody.input_tokens ?? 0),
      cachedInputTokens: Number(inputDetails.cached_tokens ?? 0),
      outputTokens: Number(usageBody.output_tokens ?? 0),
    };
    let estimatedCostMicrousd: number;
    try {
      estimatedCostMicrousd = estimateCostMicrousd({
        model: this.model,
        ...usage,
        pricing: this.pricing,
      });
    } catch {
      throw new Error("image_analysis_configuration_error");
    }

    return {
      analysis,
      provider: "openai",
      model: String(body.model ?? this.model),
      usage,
      estimatedCostMicrousd,
      latencyMs: Math.max(0, this.now() - startedAt),
    };
  }
}
