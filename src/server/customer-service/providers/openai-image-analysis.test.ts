import { describe, expect, it, vi } from "vitest";
import { OpenAIImageAnalysisProvider } from "./openai-image-analysis";

const providerOutput = {
  schemaVersion: "1",
  overallStatus: "assessed",
  images: [{
    ordinal: 1,
    classification: "screenshot_of_photo",
    blur: "mild",
    sourceResolutionSignal: "low",
    subjectScale: "usable",
    crop: "none_visible",
    obstruction: "none_visible",
    screenshotSignal: "likely",
    recommendedRole: "main_candidate",
    issueCodes: ["request_original"],
  }],
  comparison: null,
  recommendationCodes: ["send_original_file"],
  safeSummary: "Jane looks happy and this will definitely print well for $100 tomorrow.",
};

describe("OpenAI image-analysis provider", () => {
  it("sends one private, tool-free Responses API request for the image batch", async () => {
    const fetchImpl: (input: string | URL | Request, init?: RequestInit) => Promise<Response> = async () => new Response(JSON.stringify({
      model: "approved-vision-model-2026-08-01",
      output_text: JSON.stringify(providerOutput),
      usage: {
        input_tokens: 120,
        output_tokens: 40,
        input_tokens_details: { cached_tokens: 20 },
      },
    }), { status: 200 });
    const fetchSpy = vi.fn(fetchImpl);
    const provider = new OpenAIImageAnalysisProvider({
      apiKey: "test-only-secret",
      model: "approved-vision-model",
      fetchImpl: fetchSpy,
      pricing: {
        inputUsdPerMillion: 1,
        cachedInputUsdPerMillion: 0.1,
        outputUsdPerMillion: 2,
      },
      now: (() => { const values = [1_000, 1_250]; return () => values.shift() ?? 1_250; })(),
    });

    const result = await provider.analyze({
      images: [{
        ordinal: 1,
        mimeType: "image/png",
        bytes: Buffer.from("private-image-bytes"),
      }],
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(body).toMatchObject({
      model: "approved-vision-model",
      store: false,
      reasoning: { effort: "none" },
      max_output_tokens: 1_500,
      input: [{
        role: "user",
        content: expect.arrayContaining([
          { type: "input_text", text: expect.any(String) },
          {
            type: "input_image",
            image_url: expect.stringMatching(/^data:image\/(jpeg|png|webp);base64,/),
            detail: "auto",
          },
        ]),
      }],
    });
    expect(body.tools).toBeUndefined();
    expect(body.text.format).toMatchObject({
      type: "json_schema",
      strict: true,
      name: "image_analysis_result",
    });
    expect(body.text.verbosity).toBe("low");
    expect(result).toMatchObject({
      analysis: {
        safeSummary: "Image 1 appears to be a screenshot; request the original file.",
      },
      provider: "openai",
      model: "approved-vision-model-2026-08-01",
      usage: { inputTokens: 120, cachedInputTokens: 20, outputTokens: 40 },
      estimatedCostMicrousd: 182,
      latencyMs: 250,
    });
    expect(JSON.stringify(result)).not.toContain("private-image-bytes");
    expect(JSON.stringify(result)).not.toContain("test-only-secret");
    expect(JSON.stringify(result)).not.toContain("Jane");
    expect(JSON.stringify(result)).not.toContain("$100");
  });

  it("maps provider failures to a stable code without response data or request secrets", async () => {
    const privateBody = "private provider body https://private.example/customer-image.png sender-123";
    const provider = new OpenAIImageAnalysisProvider({
      apiKey: "test-only-secret",
      model: "approved-vision-model",
      fetchImpl: async () => new Response(privateBody, { status: 429 }),
      pricing: {
        inputUsdPerMillion: 1,
        cachedInputUsdPerMillion: 0.1,
        outputUsdPerMillion: 2,
      },
    });

    let thrown: unknown;
    try {
      await provider.analyze({
        images: [{
          ordinal: 1,
          mimeType: "image/jpeg",
          bytes: Buffer.from("raw-private-image"),
        }],
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("image_analysis_provider_error");
    expect(String(thrown)).not.toContain(privateBody);
    expect(String(thrown)).not.toContain("test-only-secret");
    expect(String(thrown)).not.toContain("raw-private-image");
  });

  it("maps malformed structured output to a stable schema code", async () => {
    const provider = new OpenAIImageAnalysisProvider({
      apiKey: "test-only-secret",
      model: "approved-vision-model",
      fetchImpl: async () => new Response(JSON.stringify({
        output_text: JSON.stringify({ ...providerOutput, identity: "private person" }),
        usage: {},
      }), { status: 200 }),
      pricing: {
        inputUsdPerMillion: 1,
        cachedInputUsdPerMillion: 0.1,
        outputUsdPerMillion: 2,
      },
    });

    await expect(provider.analyze({
      images: [{ ordinal: 1, mimeType: "image/webp", bytes: Buffer.from("private") }],
    })).rejects.toThrow("image_analysis_invalid_output");
  });

  it("maps missing model pricing to a stable configuration code", async () => {
    const provider = new OpenAIImageAnalysisProvider({
      apiKey: "test-only-secret",
      model: "unpriced-private-model",
      fetchImpl: async () => new Response(JSON.stringify({
        output_text: JSON.stringify(providerOutput),
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200 }),
    });

    await expect(provider.analyze({
      images: [{ ordinal: 1, mimeType: "image/png", bytes: Buffer.from("private") }],
    })).rejects.toThrow("image_analysis_configuration_error");
  });
});
