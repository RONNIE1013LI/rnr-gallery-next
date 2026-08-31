import { describe, expect, it, vi } from "vitest";
import compiledKnowledge from "../src/server/customer-service/knowledge/compiled-knowledge.json";
import { evaluateReplyAssistantCases } from "./evaluate-reply-assistant-quality";

describe("reply assistant quality evaluation", () => {
  it("blocks risky/realtime cases before provider and grades the allowed draft", async () => {
    const provider = {
      providerKind: "mock" as const,
      model: "quality-test",
      generate: vi.fn(async () => ({
        text: [
          "Canvas is a premium wall keepsake on a wooden frame, while a wall banner is flexible and hangs with eyelets.",
          "A roll-up banner is freestanding and uses its own stand, so it is best when no wall is available.",
          "Will it be displayed on a wall or freestanding?",
        ].join("\n"),
        provider: "mock" as const,
        model: "quality-test",
        usage: { inputTokens: 100, cachedInputTokens: 20, outputTokens: 30 },
        estimatedCostMicrousd: 50,
        latencyMs: 25,
      })),
    };

    const report = await evaluateReplyAssistantCases({
      cases: [
        { id: "allowed", category: "product_differences", message: "Which product should I choose?", expectedGateDecision: "DRAFT_ALLOWED" },
        { id: "risk", category: "high_risk", message: "I want a refund", expectedGateDecision: "NEEDS_HUMAN_REVIEW" },
        { id: "realtime", category: "realtime_required", message: "Is this item currently in stock?", expectedGateDecision: "REALTIME_DATA_REQUIRED" },
      ],
      knowledge: compiledKnowledge,
      provider,
    });

    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(report.summary).toMatchObject({
      total: 3,
      gateMatches: 3,
      preProviderBlocks: 2,
      successfulProviderCalls: 1,
      directlyUsable: 1,
      needsEdit: 0,
      rejected: 0,
      policyBypasses: 0,
      inputTokens: 100,
      cachedInputTokens: 20,
      outputTokens: 30,
      estimatedCostMicrousd: 50,
    });
    expect(report.results.find((result) => result.id === "risk")).toMatchObject({ providerCalled: false, draft: "" });
  });
});
