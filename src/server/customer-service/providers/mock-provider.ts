import type { AiProvider, AiProviderRequest } from "./ai-provider";

export class MockAiProvider implements AiProvider {
  readonly providerKind = "mock" as const;
  readonly model = "mock";

  async generate(_request: AiProviderRequest) {
    const expectedIntent = /Expected intent: ([a-z_]+)/.exec(_request.instructions)?.[1];
    const structured = expectedIntent ? {
      response_type: expectedIntent === "quote_information_collection" || expectedIntent === "tone_adjustment"
        ? "ASK_FOR_INFORMATION"
        : "ANSWER_SAFE",
      intent: expectedIntent,
      product_type: "UNSPECIFIED",
      missing_fields: expectedIntent === "quote_information_collection"
        ? ["PRODUCT_TYPE", "SIZE", "PEOPLE_COUNT", "PHOTO_COUNT", "REQUIRED_DATE", "DELIVERY_LOCATION"]
        : expectedIntent === "tone_adjustment" ? ["WORDING"] : [],
      follow_up_fields: expectedIntent === "quote_information_collection"
        ? ["PRODUCT_TYPE", "SIZE", "PEOPLE_COUNT", "PHOTO_COUNT", "REQUIRED_DATE", "DELIVERY_LOCATION"]
        : expectedIntent === "tone_adjustment" ? ["WORDING"] : [],
      allowed_facts: expectedIntent === "product_differences"
        ? ["CANVAS_WALL_KEEPSAKE", "BANNER_DISPLAY_OPTIONS"]
        : expectedIntent === "design_process"
          ? ["DESIGN_INPUTS", "DESIGN_DRAFT_REVIEW_BEFORE_PRINTING"]
          : expectedIntent === "photo_guidance"
            ? ["PHOTO_ORIGINAL_FILES", "PHOTO_QUALITY_ASSESSMENT"]
            : expectedIntent === "production_process"
              ? ["PRODUCTION_AFTER_APPROVAL"]
              : expectedIntent === "payment_process" ? ["PAYMENT_DEPOSIT_STARTS_DESIGN"] : [],
      human_review_reason: "NONE",
    } : null;
    return {
      text: structured
        ? JSON.stringify(structured)
        : "Please send the details and we can check them for you 😊",
      provider: "mock" as const,
      model: "mock",
      usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
      estimatedCostMicrousd: 0,
      latencyMs: 0,
    };
  }
}
