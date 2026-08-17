import { estimateCostMicrousd } from "../usage-cost";
import type { AiProvider, AiProviderRequest, AiProviderResult } from "./ai-provider";

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function asNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function usageFrom(body: Record<string, unknown>) {
  const usageBody = body.usage;
  if (!usageBody || typeof usageBody !== "object" || Array.isArray(usageBody)) return null;
  const usage = usageBody as Record<string, unknown>;
  const inputTokens = asNonNegativeInteger(usage.input_tokens);
  const outputTokens = asNonNegativeInteger(usage.output_tokens);
  if (inputTokens === null || outputTokens === null) return null;
  const details = usage.input_tokens_details;
  if (details !== undefined && (!details || typeof details !== "object" || Array.isArray(details))) return null;
  const cachedValue = details && typeof details === "object"
    ? (details as Record<string, unknown>).cached_tokens
    : undefined;
  const cachedTokens = cachedValue === undefined ? 0 : asNonNegativeInteger(cachedValue);
  if (cachedTokens === null) return null;
  return { inputTokens, cachedInputTokens: cachedTokens, outputTokens };
}

export class OpenAIResponsesProvider implements AiProvider {
  readonly providerKind = "openai" as const;
  readonly model: string;
  private readonly apiKey: string;
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
    const knownUsage = usageFrom(body);
    const usage = knownUsage ?? { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
    const model = String(body.model ?? this.model);
    const directText = typeof body.output_text === "string" ? body.output_text : "";
    const outputText = Array.isArray(body.output)
      ? body.output.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const content = (item as Record<string, unknown>).content;
        if (!Array.isArray(content)) return [];
        return content.flatMap((part) => {
          if (!part || typeof part !== "object") return [];
          const value = part as Record<string, unknown>;
          return value.type === "output_text" && typeof value.text === "string" ? [value.text] : [];
        });
      }).join("\n")
      : "";
    const text = (directText || outputText).trim();
    if (!text) throw new Error("openai_empty_output");
    return {
      text,
      provider: "openai",
      model,
      usage,
      estimatedCostMicrousd: knownUsage ? estimateCostMicrousd({ model: this.model, ...knownUsage }) : null,
      latencyMs: Math.max(0, this.now() - startedAt),
    };
  }
}
