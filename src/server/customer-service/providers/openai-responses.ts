import { estimateCostMicrousd } from "../usage-cost";
import type { AiProvider, AiProviderRequest, AiProviderResult } from "./ai-provider";

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class OpenAIResponsesProvider implements AiProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: FetchImplementation;
  private readonly now: () => number;

  constructor({
    apiKey,
    model = "gpt-5.6-luna",
    fetchImpl = fetch,
    now = Date.now,
  }: Readonly<{
    apiKey: string;
    model?: string;
    fetchImpl?: FetchImplementation;
    now?: () => number;
  }>) {
    this.apiKey = apiKey;
    this.model = model;
    this.fetchImpl = fetchImpl;
    this.now = now;
  }

  async generate(request: AiProviderRequest): Promise<AiProviderResult> {
    if (!this.apiKey) throw new Error("OPENAI_API_KEY is required");
    const startedAt = this.now();
    const response = await this.fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        instructions: request.instructions,
        input: request.input,
        store: false,
        reasoning: { effort: "none" },
        max_output_tokens: 220,
        text: { verbosity: "low" },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`openai_http_${response.status}`);
    const body = await response.json() as Record<string, unknown>;
    const usageBody = (body.usage ?? {}) as Record<string, unknown>;
    const inputDetails = (usageBody.input_tokens_details ?? {}) as Record<string, unknown>;
    const usage = {
      inputTokens: Number(usageBody.input_tokens ?? 0),
      cachedInputTokens: Number(inputDetails.cached_tokens ?? 0),
      outputTokens: Number(usageBody.output_tokens ?? 0),
    };
    const model = String(body.model ?? this.model);
    const directText = typeof body.output_text === "string" ? body.output_text : "";
    const text = directText.trim();
    if (!text) throw new Error("openai_empty_output");
    return {
      text,
      provider: "openai",
      model,
      usage,
      estimatedCostMicrousd: estimateCostMicrousd({ model: this.model, ...usage }),
      latencyMs: Math.max(0, this.now() - startedAt),
    };
  }
}
