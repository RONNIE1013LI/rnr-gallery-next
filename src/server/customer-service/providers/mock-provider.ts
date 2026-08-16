import type { AiProvider, AiProviderRequest } from "./ai-provider";

export class MockAiProvider implements AiProvider {
  async generate(_request: AiProviderRequest) {
    return {
      text: "Please send the details and we can check them for you 😊",
      provider: "mock" as const,
      model: "mock",
      usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
      estimatedCostMicrousd: 0,
      latencyMs: 0,
    };
  }
}
