import { z } from "zod";
import type { DiagnosticReason, ProviderDiagnostic } from "../diagnostics";
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

  constructor(code: SolProviderErrorCode, readonly reason: DiagnosticReason = ({
    configuration: "provider_not_called", timeout: "provider_timeout", transient_transport: "provider_connection_error",
    rate_limited: "provider_rate_limit", invalid_output: "structured_output_invalid", permanent_provider: "provider_http_error",
  } as const)[code]) {
    super(`sol_provider_${code}`);
    this.name = "SolProviderError";
    this.code = code;
  }
}

const toolRequestInputSchema = z.object({
  product: z.string().nullable(),
  size: z.string().nullable(),
  destination: z.string().nullable(),
  orderReference: z.string().nullable(),
}).strict();

export const toolRequestSchema = z.object({
  name: z.enum(["canonical_product_price", "dynamic_shipping_quote", "order_status", "payment_status"]),
  input: toolRequestInputSchema,
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
  deadlineAt?: number;
  retryMinimumMs?: number;
  onDiagnostic?: (entry: ProviderDiagnostic) => void;
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

async function httpError(response: Response, diagnostic: ProviderDiagnostic): Promise<SolProviderError> {
  // Never retain the free-form provider message or unknown code/type in diagnostics.
  let reason: DiagnosticReason = "provider_http_error";
  try {
    const raw = await response.text();
    diagnostic.responseBytes = raw.length > 0;
    const body: unknown = JSON.parse(raw);
    const error = body && typeof body === "object" && "error" in body ? body.error : null;
    const codes = error && typeof error === "object" ? ["code" in error ? error.code : null, "type" in error ? error.type : null] : [];
    if (codes.some(code => ["insufficient_quota", "credit_balance_exhausted", "billing_hard_limit_reached"].includes(String(code)))) reason = "provider_credit_or_quota_failure";
    else if (codes.some(code => ["model_not_found", "model_not_available", "model_access_denied"].includes(String(code)))) reason = "model_not_available";
  } catch { /* HTTP status remains available when the error body is not JSON. */ }
  if (reason === "provider_http_error") {
    if (response.status === 401 || response.status === 403) reason = "provider_auth_failure";
    else if (response.status === 429) reason = "provider_rate_limit";
    else if (response.status === 408) reason = "provider_timeout";
  }
  // Preserve existing retry/error-code semantics.
  const code: SolProviderErrorCode = response.status === 408 ? "timeout" : response.status === 429 ? "rate_limited"
    : response.status >= 500 ? "transient_transport" : [401, 403].includes(response.status) ? "configuration"
    : [400, 422].includes(response.status) ? "invalid_output" : "permanent_provider";
  return new SolProviderError(code, reason);
}
function errorClass(reason: DiagnosticReason): ProviderDiagnostic["errorClass"] {
  switch (reason) {
    case "provider_auth_failure": return "auth";
    case "provider_credit_or_quota_failure": return "quota";
    case "provider_rate_limit": return "rate_limit";
    case "provider_http_error": return "http";
    case "provider_connection_error": return "connection";
    case "provider_timeout": case "reasoning_timeout": return "timeout";
    case "model_not_available": case "model_mismatch": return "model";
    case "response_parse_failure": case "response_empty": return "parse";
    case "structured_output_invalid": return "schema";
    case "response_incomplete": return "incomplete";
    default: return "configuration";
  }
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
  readonly model = "gpt-5.6-luna" as const;
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
    return this.structured(request, solStructuredResultSchema);
  }

  async structured<T>(request: SolProviderRequest, schema: z.ZodType<T>, outputTokens = 1_200): Promise<Readonly<{decision: T; model: string; usage: SolProviderResult["usage"]}>> {
    if (!this.apiKey) throw new SolProviderError("configuration");
    if (!request.instructions.trim() || !request.conversationText.trim()) {
      throw new SolProviderError("invalid_output");
    }

    const images = [...request.images].sort((left, right) => left.ordinal - right.ordinal);
    if (images.some((image) => image.bytes.byteLength < 1)) {
      throw new SolProviderError("invalid_output");
    }
    const content = [
      { type: "input_text", text: request.conversationText.trim() },
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
      max_output_tokens: outputTokens,
      input: [{ role: "developer", content: request.instructions.trim() }, { role: "user", content }],
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "rnr_ai_reply_decision",
          strict: true,
          schema: z.toJSONSchema(schema, { target: "draft-7" }),
        },
      },
    });

    let lastError = new SolProviderError("transient_transport");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const startedAt = Date.now();
      const diagnostic: ProviderDiagnostic = {
        phase: "start", attempt: attempt + 1, providerCalled: false, httpStatus: null, latencyMs: 0,
        responseReturned: false, responseBytes: false, responseText: false, parsed: false, structuredValid: false,
        reason: "none", timeoutSource: "none", errorClass: "none", incompleteReason: "none",
      };
      const emit = (phase: ProviderDiagnostic["phase"]) => {
        try { request.onDiagnostic?.({ ...diagnostic, phase, latencyMs: Math.max(0, Date.now() - startedAt) }); } catch { /* No effect on retries or safety. */ }
      };
      try {
        const remaining = request.deadlineAt === undefined ? 25_000 : Math.min(25_000, request.deadlineAt - Date.now());
        if (remaining < 1) throw new SolProviderError("timeout", "reasoning_timeout");
        const signal = this.timeoutSignal(remaining);
        diagnostic.providerCalled = true;
        emit("start");
        const response = await this.fetchImpl("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
          body, signal,
        });
        diagnostic.httpStatus = response.status;
        diagnostic.responseReturned = true;
        emit("response");
        if (!response.ok) throw await httpError(response, diagnostic);
        const raw = await response.text();
        diagnostic.responseBytes = raw.length > 0;
        if (!raw.trim()) throw new SolProviderError("invalid_output", "response_empty");
        const decoded: unknown = JSON.parse(raw);
        if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new SolProviderError("invalid_output", "structured_output_invalid");
        const responseBody = decoded as Record<string, unknown>;
        const text = outputText(responseBody);
        diagnostic.responseText = text.length > 0;
        if (responseBody.status === "incomplete") {
          const detail = responseBody.incomplete_details;
          const reason = detail && typeof detail === "object" && "reason" in detail ? detail.reason : null;
          diagnostic.incompleteReason = reason === "max_output_tokens" || reason === "content_filter" ? reason : "other";
          throw new SolProviderError("invalid_output", "response_incomplete");
        }
        if (typeof responseBody.model === "string" && responseBody.model !== this.model) throw new SolProviderError("invalid_output", "model_mismatch");
        if (!text.trim()) throw new SolProviderError("invalid_output", "response_empty");
        const parsed: unknown = JSON.parse(text);
        diagnostic.parsed = true;
        const decision = schema.parse(parsed);
        diagnostic.structuredValid = true;
        emit("finish");
        return Object.freeze({ decision, model: typeof responseBody.model === "string" ? responseBody.model : this.model, usage: Object.freeze(parseUsage(responseBody)) });
      } catch (error) {
        lastError = error instanceof SyntaxError ? new SolProviderError("invalid_output", "response_parse_failure")
          : error instanceof z.ZodError ? new SolProviderError("invalid_output", "structured_output_invalid") : transportError(error);
        diagnostic.reason = lastError.reason;
        diagnostic.errorClass = errorClass(lastError.reason);
        if (lastError.code === "timeout") diagnostic.timeoutSource = lastError.reason === "reasoning_timeout" || (request.deadlineAt !== undefined && Date.now() >= request.deadlineAt) ? "orchestration" : "provider";
        emit("finish");
        if (!retryable(lastError) || attempt === 1) throw lastError;
        const retryRemaining = request.deadlineAt === undefined ? 25_000 : request.deadlineAt - Date.now();
        if (retryRemaining < (request.retryMinimumMs ?? 1)) throw lastError;
      }
    }
    throw lastError;
  }
}
