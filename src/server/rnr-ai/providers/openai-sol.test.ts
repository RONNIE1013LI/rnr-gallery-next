import { describe, expect, it, vi } from "vitest";
import { OpenAiSolProvider, SolProviderError } from "./openai-sol";

const successfulBody = {
  model: "gpt-5.6-luna",
  output_text: JSON.stringify({
    risk: "GREEN",
    intent: "PRICE",
    replyText: "Our A2 price is available in the current price book.",
    reasons: [],
    claims: [{ kind: "price", value: "A2", sourceId: "au-photo-canvas-prices" }],
    requestedTools: [],
  }),
  usage: {
    input_tokens: 100,
    output_tokens: 20,
    input_tokens_details: { cached_tokens: 10 },
  },
};

describe("OpenAiSolProvider", () => {
  it("uses the exact Luna model, non-storage, strict schema and ordered text/images", async () => {
    const fetchImpl = vi.fn(async (...args: [string | URL | Request, RequestInit?]) => {
      void args;
      return new Response(JSON.stringify(successfulBody), { status: 200 });
    });
    const timeoutSignal = vi.fn(() => new AbortController().signal);
    const provider = new OpenAiSolProvider({ apiKey: "secret", fetchImpl, timeoutSignal });

    const result = await provider.generate({
      instructions: "Use only supported facts.",
      conversationText: "customer: How much is A2?",
      images: [
        { ordinal: 2, mediaType: "image/png", bytes: new Uint8Array([1, 2]), sha256: "a".repeat(64), width: 10, height: 10 },
        { ordinal: 1, mediaType: "image/jpeg", bytes: new Uint8Array([3, 4]), sha256: "b".repeat(64), width: 10, height: 10 },
      ],
    });

    expect(timeoutSignal).toHaveBeenCalledWith(25_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(body).toMatchObject({
      model: "gpt-5.6-luna",
      store: false,
      reasoning: { effort: "medium" },
      text: { format: { type: "json_schema", strict: true } },
    });
    expect(JSON.stringify(body.text.format.schema)).not.toContain("propertyNames");
    expect(body.text.format.schema.properties.requestedTools.items.properties.input).toMatchObject({
      type: "object",
      required: ["product", "size", "destination", "orderReference"],
      additionalProperties: false,
    });
    expect(body.input[0]).toEqual({role:"developer",content:"Use only supported facts."});
    expect(body.input[1].role).toBe("user");
    expect(body).not.toHaveProperty("previous_response_id");
    expect(body.input[1].content.map((item: { type: string }) => item.type)).toEqual([
      "input_text",
      "input_image",
      "input_image",
    ]);
    expect(body.input[1].content[1].image_url).toBe("data:image/jpeg;base64,AwQ=");
    expect(body.input[1].content[2].image_url).toBe("data:image/png;base64,AQI=");
    expect(result).toMatchObject({
      model: "gpt-5.6-luna",
      usage: { inputTokens: 100, cachedInputTokens: 10, outputTokens: 20 },
      decision: { risk: "GREEN", intent: "PRICE" },
    });
  });

  it.each([408, 429, 500, 503])("retries HTTP %s once", async (status) => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response("temporary", { status }))
      .mockResolvedValueOnce(new Response(JSON.stringify(successfulBody), { status: 200 }));
    const provider = new OpenAiSolProvider({ apiKey: "secret", fetchImpl });

    await expect(provider.generate({ instructions: "safe", conversationText: "hello", images: [] }))
      .resolves.toMatchObject({ decision: { risk: "GREEN" } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries a network reset once and classifies exhaustion", async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError("fetch failed"); });
    const provider = new OpenAiSolProvider({ apiKey: "secret", fetchImpl });

    await expect(provider.generate({ instructions: "safe", conversationText: "hello", images: [] }))
      .rejects.toMatchObject({ code: "transient_transport" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([
    [400, "invalid_output"],
    [401, "configuration"],
    [403, "configuration"],
  ] as const)("classifies HTTP %s as %s without retry", async (status, code) => {
    const fetchImpl = vi.fn(async () => new Response("bad", { status }));
    const provider = new OpenAiSolProvider({ apiKey: "secret", fetchImpl });

    await expect(provider.generate({ instructions: "safe", conversationText: "hello", images: [] }))
      .rejects.toMatchObject({ code });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not start or retry a call after the shared deadline", async () => {
    const fetchImpl=vi.fn();const provider=new OpenAiSolProvider({apiKey:"unit-test-only",fetchImpl});
    await expect(provider.generate({instructions:"safe",conversationText:"hello",images:[],deadlineAt:Date.now()-1})).rejects.toMatchObject({code:"timeout"});
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("retries only when the current stage retains the minimum attempt budget", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const enoughFetch = vi.fn()
        .mockImplementationOnce(async () => { vi.setSystemTime(1_000); throw new DOMException("bounded timeout", "TimeoutError"); })
        .mockResolvedValueOnce(Response.json(successfulBody));
      const enough = new OpenAiSolProvider({ apiKey: "unit-test-only", fetchImpl: enoughFetch });
      await expect(enough.generate({ instructions: "safe", conversationText: "hello", images: [], deadlineAt: 5_000, retryMinimumMs: 3_000 })).resolves.toBeDefined();
      expect(enoughFetch).toHaveBeenCalledTimes(2);

      vi.setSystemTime(0);
      const diagnostics: Array<{ attempt: number; phase: string }> = [];
      const shortFetch = vi.fn(async () => { vi.setSystemTime(3_000); throw new DOMException("bounded timeout", "TimeoutError"); });
      const short = new OpenAiSolProvider({ apiKey: "unit-test-only", fetchImpl: shortFetch });
      await expect(short.generate({ instructions: "safe", conversationText: "hello", images: [], deadlineAt: 5_000, retryMinimumMs: 3_000, onDiagnostic: entry => diagnostics.push(entry) })).rejects.toMatchObject({ code: "timeout" });
      expect(shortFetch).toHaveBeenCalledOnce();
      expect(diagnostics.every(entry => entry.attempt === 1)).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it("rejects an HTTP 200 whose body does not finish before the stage deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      let aborted = false;
      const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => ({
        ok: true,
        status: 200,
        text: () => new Promise<string>((resolve, reject) => {
          const signal = init?.signal;
          const timer = setTimeout(() => resolve(JSON.stringify(successfulBody)), 6_000);
          signal?.addEventListener("abort", () => { aborted = true; clearTimeout(timer); reject(new DOMException("late body", "TimeoutError")); });
        }),
      } as Response));
      const timeoutSignal = (milliseconds: number) => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), milliseconds);
        return controller.signal;
      };
      const provider = new OpenAiSolProvider({ apiKey: "unit-test-only", fetchImpl, timeoutSignal });
      const pending = provider.generate({ instructions: "safe", conversationText: "hello", images: [], deadlineAt: 5_000, retryMinimumMs: 3_000 });
      const rejected = expect(pending).rejects.toMatchObject({ code: "timeout" });
      await vi.advanceTimersByTimeAsync(5_001);
      await rejected;
      expect(fetchImpl).toHaveBeenCalledOnce();
      expect(aborted).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it.each([{...successfulBody,model:"weaker-model"},{...successfulBody,status:"incomplete"}])("rejects non-equivalent or incomplete output", async body => {
    const fetchImpl=vi.fn(async()=>Response.json(body));const provider=new OpenAiSolProvider({apiKey:"unit-test-only",fetchImpl});
    await expect(provider.generate({instructions:"safe",conversationText:"hello",images:[]})).rejects.toMatchObject({code:"invalid_output"});expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("rejects invalid output and never logs secrets or response bodies", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ output_text: "not-json" }), { status: 200 }));
    const provider = new OpenAiSolProvider({ apiKey: "super-secret", fetchImpl });

    await expect(provider.generate({ instructions: "safe", conversationText: "hello", images: [] }))
      .rejects.toBeInstanceOf(SolProviderError);
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
