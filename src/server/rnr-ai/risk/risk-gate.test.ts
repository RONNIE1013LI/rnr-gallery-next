import { describe, expect, it } from "vitest";
import { evaluateFinalRisk } from "./risk-gate";

describe("evaluateFinalRisk", () => {
  it.each([
    ["Where are you based?", "GREEN"],
    ["Can you combine people from different photos?", "GREEN"],
    ["Can you create a complex custom quote for tomorrow?", "YELLOW"],
    ["Can I have an unusual split payment arrangement?", "YELLOW"],
    ["I want a refund", "RED"],
    ["I will start a chargeback", "RED"],
    ["Give me a special discount", "RED"],
    ["I want compensation for a serious complaint", "RED"],
  ] as const)("classifies deterministic risk for: %s", (message, risk) => {
    expect(evaluateFinalRisk({ message, modelRisk: "GREEN" }).risk).toBe(risk);
  });

  it("never lets a model downgrade a deterministic RED result", () => {
    expect(evaluateFinalRisk({ message: "Refund this payment", modelRisk: "GREEN" })).toMatchObject({
      risk: "RED",
      autoReplyEligible: false,
    });
  });

  it("never lets a model downgrade a REVIEW-derived YELLOW result", () => {
    expect(evaluateFinalRisk({
      message: "How much is it?",
      businessRuleStatuses: ["REVIEW"],
      modelRisk: "GREEN",
    })).toMatchObject({ risk: "YELLOW", autoReplyEligible: false });
  });

  it.each([
    ["incomplete material context", { incompleteMaterialContext: true }, "YELLOW"],
    ["failed live tool", { toolFailed: true }, "RED"],
    ["unsupported claim", { unsupportedClaim: true }, "RED"],
    ["unsafe output", { outputRisk: "RED" as const }, "RED"],
    ["channel review", { channelRisk: "YELLOW" as const }, "YELLOW"],
  ])("escalates %s", (_label, input, risk) => {
    expect(evaluateFinalRisk({ message: "Hello", modelRisk: "GREEN", ...input }).risk).toBe(risk);
  });

  it("returns GREEN eligibility only when every layer remains GREEN", () => {
    expect(evaluateFinalRisk({
      message: "Do you make canvas prints?",
      knowledgeRisk: "GREEN",
      toolRisk: "GREEN",
      modelRisk: "GREEN",
      outputRisk: "GREEN",
      channelRisk: "GREEN",
    })).toEqual({
      risk: "GREEN",
      autoReplyEligible: true,
      reasons: [],
    });
  });
});
