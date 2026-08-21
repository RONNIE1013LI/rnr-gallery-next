import { describe, expect, it, vi } from "vitest";
import { OpenAIResponsesProvider } from "./openai-responses";

describe("OpenAI Responses provider", () => {
  it("uses Responses API with storage disabled and returns safe usage", async () => {
    const fetchSpy = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      model: "gpt-5.6-luna-2026-08-01",
      output_text: "Please send the original photo and we can assess it for you 😊",
      usage: {
        input_tokens: 100,
        output_tokens: 30,
        input_tokens_details: { cached_tokens: 20 },
      },
    }), { status: 200 }));
    const provider = new OpenAIResponsesProvider({
      apiKey: "test-only-secret",
      model: "gpt-5.6-luna",
      fetchImpl: fetchSpy,
      now: (() => { const values = [1_000, 1_250]; return () => values.shift() ?? 1_250; })(),
    });

    const result = await provider.generate({ instructions: "rules", input: "message" });
    expect(fetchSpy).toHaveBeenCalledWith("https://api.openai.com/v1/responses", expect.objectContaining({ method: "POST" }));
    const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(body).toMatchObject({ model: "gpt-5.6-luna", store: false, max_output_tokens: 220 });
    expect(result).toMatchObject({
      text: "Please send the original photo and we can assess it for you 😊",
      model: "gpt-5.6-luna-2026-08-01",
      usage: { inputTokens: 100, cachedInputTokens: 20, outputTokens: 30 },
      latencyMs: 250,
    });
    expect(JSON.stringify(result)).not.toContain("test-only-secret");
  });

  it("returns a safe error code without exposing provider bodies", async () => {
    const provider = new OpenAIResponsesProvider({
      apiKey: "test-only-secret",
      fetchImpl: async () => new Response(JSON.stringify({ error: { message: "private body" } }), { status: 429 }),
    });
    await expect(provider.generate({ instructions: "x", input: "y" })).rejects.toThrow("openai_http_429");
  });

  it("reads output text from the raw Responses API content array", async () => {
    const provider = new OpenAIResponsesProvider({
      apiKey: "test-only-secret",
      fetchImpl: async () => new Response(JSON.stringify({
        model: "gpt-5.6-luna-2026-08-01",
        output: [{
          type: "message",
          content: [{ type: "output_text", text: "Please send the original photo for assessment 😊" }],
        }],
        usage: { input_tokens: 12, output_tokens: 8 },
      }), { status: 200 }),
    });

    await expect(provider.generate({ instructions: "rules", input: "message" })).resolves.toMatchObject({
      text: "Please send the original photo for assessment 😊",
    });
  });

  it("preserves an unknown cost when a successful response omits usage", async () => {
    const provider = new OpenAIResponsesProvider({
      apiKey: "test-only-secret",
      fetchImpl: async () => new Response(JSON.stringify({
        output_text: "Please send the original photo for assessment 😊",
      }), { status: 200 }),
    });

    await expect(provider.generate({ instructions: "rules", input: "message" })).resolves.toMatchObject({
      usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
      estimatedCostMicrousd: null,
    });
  });

  it("preserves an unknown cost when successful usage is malformed", async () => {
    const provider = new OpenAIResponsesProvider({
      apiKey: "test-only-secret",
      fetchImpl: async () => new Response(JSON.stringify({
        output_text: "Please send the original photo for assessment 😊",
        usage: { input_tokens: "not-a-number", output_tokens: 8 },
      }), { status: 200 }),
    });

    await expect(provider.generate({ instructions: "rules", input: "message" })).resolves.toMatchObject({
      estimatedCostMicrousd: null,
    });
  });

  it("preserves an unknown cost when cached usage exceeds input usage", async () => {
    const provider = new OpenAIResponsesProvider({
      apiKey: "test-only-secret",
      fetchImpl: async () => new Response(JSON.stringify({
        output_text: "Please send the original photo for assessment 😊",
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          input_tokens_details: { cached_tokens: 1 },
        },
      }), { status: 200 }),
    });

    await expect(provider.generate({ instructions: "rules", input: "message" })).resolves.toMatchObject({
      estimatedCostMicrousd: null,
    });
  });

  it("keeps complete usage authoritative when cached usage equals input usage", async () => {
    const provider = new OpenAIResponsesProvider({
      apiKey: "test-only-secret",
      fetchImpl: async () => new Response(JSON.stringify({
        output_text: "Please send the original photo for assessment 😊",
        usage: {
          input_tokens: 1_000_000,
          output_tokens: 0,
          input_tokens_details: { cached_tokens: 1_000_000 },
        },
      }), { status: 200 }),
    });

    await expect(provider.generate({ instructions: "rules", input: "message" })).resolves.toMatchObject({
      usage: { inputTokens: 1_000_000, cachedInputTokens: 1_000_000, outputTokens: 0 },
      estimatedCostMicrousd: 20_000,
    });
  });

  it("requires a key before any fetch", async () => {
    const fetchSpy = vi.fn();
    const provider = new OpenAIResponsesProvider({ apiKey: "", fetchImpl: fetchSpy });
    await expect(provider.generate({ instructions: "x", input: "y" })).rejects.toThrow("OPENAI_API_KEY is required");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("requests strict server-side JSON schema without changing ordinary responses", async () => {
    const fetchSpy = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => new Response(JSON.stringify({
      output_text: "{}",
      usage: { input_tokens: 5, output_tokens: 2 },
    }), { status: 200 }));
    const provider = new OpenAIResponsesProvider({ apiKey: "test-only-secret", fetchImpl: fetchSpy });
    const schema = {
      type: "object",
      properties: { response_type: { type: "string", enum: ["ANSWER_SAFE"] } },
      required: ["response_type"],
      additionalProperties: false,
    } as const;

    await provider.generate({
      instructions: "select only",
      input: "untrusted data",
      responseFormat: { name: "website_customer_service_decision_v1", schema },
    });

    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
    expect(body.text).toEqual({
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "website_customer_service_decision_v1",
        strict: true,
        schema,
      },
    });
    expect(JSON.stringify(body)).not.toContain("test-only-secret");
  });
});
