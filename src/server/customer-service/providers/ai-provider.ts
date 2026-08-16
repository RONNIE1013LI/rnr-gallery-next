export type AiProviderRequest = Readonly<{
  instructions: string;
  input: string;
}>;

export type AiProviderResult = Readonly<{
  text: string;
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

export interface AiProvider {
  generate(request: AiProviderRequest): Promise<AiProviderResult>;
}
