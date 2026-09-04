import { z } from "zod";
import type { VerifiedImageInput } from "../types";

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type SolProviderErrorCode =
  | "configuration"
  | "timeout"
  | "transient_transport"
  | "rate_limited"
  | "invalid_output"
  | "permanent_provider";

export class SolProviderError extends Error {
  readonly code: SolProviderErrorCode;

  constructor(code: SolProviderErrorCode) {
    super(`sol_provider_${code}`);
    this.name = "SolProviderError";
    this.code = code;
  }
}

const toolRequestSchema = z.object({
  name: z.enum(["canonical_product_price", "dynamic_shipping_quote", "order_status", "payment_status"]),
  input: z.record(z.string(), z.unknown()),
}).strict();

export const solStructuredResultSchema = z.object({
  risk: z.enum(["GREEN", "YELLOW", "RED"]),
  intent: z.string().trim().min(1),
  replyText: z.string().trim().min(1).nullable(),
  reasons: z.array(z.string().trim().min(1)),
  claims: z.array(z.object({
    kind: z.string().trim().min(1),
    value: z.string().trim().min(1),
    sourceId: z.string().trim().min(1),
  }).strict()),
  requestedTools: z.array(toolRequestSchema),
}).strict();

export type SolStructuredResult = z.infer<typeof solStructuredResultSchema>;

export type SolProviderRequest = Readonly<{
  instructions: string;
  conversationText: string;
  images: readonly VerifiedImageInput[];
}>;

export type SolProviderResult = Readonly<{
  decision: SolStructuredResult;
  model: string;
  usage: Readonly<{
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
  }>;
}>;

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

function nonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function parseUsage(body: Record<string, unknown>) {
  const raw = body.usage;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
  }
  const usage = raw as Record<string, unknown>;
  const detail = usage.input_tokens_details;
  const cached = detail && typeof detail === "object" && !Array.isArray(detail)
    ? (detail as Record<string, unknown>).cached_tokens
    : 0;
  return {
    inputTokens: nonNegativeInteger(usage.input_tokens),
    cachedInputTokens: nonNegativeInteger(cached),
    outputTokens: nonNegativeInteger(usage.output_tokens),
  };
}

function httpError(response: Response): SolProviderError {
  if (response.status === 408) return new SolProviderError("timeout");
  if (response.status === 429) return new SolProviderError("rate_limited");
  if (response.status >= 500) return new SolProviderError("transient_transport");
  if (response.status === 401 || response.status === 403) return new SolProviderError("configuration");
  if (response.status === 400 || response.status === 422) return new SolProviderError("invalid_output");
  return new SolProviderError("permanent_provider");
}

function transportError(error: unknown) {
  if (error instanceof SolProviderError) return error;
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new SolProviderError("timeout");
  }
  return new SolProviderError("transient_transport");
}

function retryable(error: SolProviderError) {
  return error.code === "timeout"
    || error.code === "rate_limited"
    || error.code === "transient_transport";
}

export class OpenAiSolProvider {
  readonly model = "gpt-5.6-sol" as const;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchImplementation;
  private readonly timeoutSignal: (milliseconds: number) => AbortSignal;

  constructor({
    apiKey,
    fetchImpl = fetch,
    timeoutSignal = AbortSignal.timeout,
  }: Readonly<{
    apiKey: string;
    fetchImpl?: FetchImplementation;
    timeoutSignal?: (milliseconds: number) => AbortSignal;
  }>) {
    this.apiKey = apiKey.trim();
    this.fetchImpl = fetchImpl;
    this.timeoutSignal = timeoutSignal;
  }

  async generate(request: SolProviderRequest): Promise<SolProviderResult> {
    if (!this.apiKey) throw new SolProviderError("configuration");
    if (!request.instructions.trim() || !request.conversationText.trim()) {
      throw new SolProviderError("invalid_output");
    }

    const images = [...request.images].sort((left, right) => left.ordinal - right.ordinal);
    if (images.some((image) => image.bytes.byteLength < 1)) {
      throw new SolProviderError("invalid_output");
    }
    const content = [
      { type: "input_text", text: `${request.instructions.trim()}\n\nConversation:\n${request.conversationText.trim()}` },
      ...images.map((image) => ({
        type: "input_image",
        image_url: `data:${image.mediaType};base64,${Buffer.from(image.bytes).toString("base64")}`,
        detail: "auto",
      })),
    ];
    const body = JSON.stringify({
      model: this.model,
      store: false,
      reasoning: { effort: "medium" },
      max_output_tokens: 1_200,
      input: [{ role: "user", content }],
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "rnr_ai_reply_decision",
          strict: true,
          schema: z.toJSONSchema(solStructuredResultSchema, { target: "draft-7" }),
        },
      },
    });

    let lastError = new SolProviderError("transient_transport");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await this.fetchImpl("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            "content-type": "application/json",
          },
          body,
          signal: this.timeoutSignal(25_000),
        });
        if (!response.ok) throw httpError(response);

        const responseBody = await response.json() as Record<string, unknown>;
        const decision = solStructuredResultSchema.parse(JSON.parse(outputText(responseBody)));
        return Object.freeze({
          decision,
          model: typeof responseBody.model === "string" ? responseBody.model : this.model,
          usage: Object.freeze(parseUsage(responseBody)),
        });
      } catch (error) {
        if (error instanceof SyntaxError || error instanceof z.ZodError) {
          throw new SolProviderError("invalid_output");
        }
        lastError = transportError(error);
        if (!retryable(lastError) || attempt === 1) throw lastError;
      }
    }
    throw lastError;
  }
}
