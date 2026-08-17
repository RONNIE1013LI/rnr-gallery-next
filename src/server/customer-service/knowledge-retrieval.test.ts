import { describe, expect, it } from "vitest";
import compiledKnowledge from "./knowledge/compiled-knowledge.json";
import { evaluatePolicyGate } from "./policy-gate";
import { retrieveKnowledge } from "./knowledge-retrieval";
import { validateDraft } from "./output-validator";

describe("customer service knowledge retrieval", () => {
  it("returns only confirmed rules selected by an allowed gate", () => {
    const gate = evaluatePolicyGate({
      message: "Can you use my blurry original photo?",
      knowledge: compiledKnowledge,
    });
    const result = retrieveKnowledge({ gate, knowledge: compiledKnowledge });

    expect(result.rules).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "AI-SCOPE-05", evidenceStatus: "CONFIRMED" }),
    ]));
    expect(result.rules.every((rule) => rule.evidenceStatus === "CONFIRMED")).toBe(true);
    expect(result.examples.length).toBeLessThanOrEqual(3);
    expect(result.qualityGuide?.intent).toBe("photo_guidance");
    expect(result.goldenExamples.length).toBeGreaterThan(0);
  });

  it("returns the complete confirmed product-difference bundle", () => {
    const gate = evaluatePolicyGate({
      message: "What is the difference between a canvas and a wall banner?",
      knowledge: compiledKnowledge,
    });
    const result = retrieveKnowledge({ gate, knowledge: compiledKnowledge });
    const ids = result.rules.map((rule) => rule.id);

    expect(ids).toEqual(expect.arrayContaining([
      "AI-SCOPE-02",
      "PRODUCT-04",
      "PRODUCT-05",
      "PRODUCT-06",
    ]));
    expect(result.qualityGuide?.requiredPoints.map((point) => point.id)).toEqual(
      expect.arrayContaining(["display_method", "product_structure", "recommendation_reason"]),
    );
    expect(result.goldenExamples.length).toBeGreaterThan(0);
    expect(result.goldenExamples.length).toBeLessThanOrEqual(2);
    expect(result.goldenExamples.every((example) => (
      validateDraft(example.approvedAnswer, { intent: "product_differences" }).ok
    ))).toBe(true);
  });

  it("returns the complete confirmed design-process bundle", () => {
    const gate = evaluatePolicyGate({ message: "How does the design process work?", knowledge: compiledKnowledge });
    const result = retrieveKnowledge({ gate, knowledge: compiledKnowledge });
    const ids = result.rules.map((rule) => rule.id);

    expect(ids).toEqual(expect.arrayContaining(["AI-SCOPE-04", "DESIGN-01", "DESIGN-06", "PHOTO-01"]));
    expect(result.qualityGuide?.intent).toBe("design_process");
  });

  it("returns no facts when the gate blocks", () => {
    const gate = evaluatePolicyGate({ message: "I want a refund", knowledge: compiledKnowledge });
    expect(retrieveKnowledge({ gate, knowledge: compiledKnowledge })).toEqual({
      rules: [],
      examples: [],
      goldenExamples: [],
      qualityGuide: null,
    });
  });
});
