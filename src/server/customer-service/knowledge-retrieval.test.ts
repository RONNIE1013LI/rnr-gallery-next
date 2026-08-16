import { describe, expect, it } from "vitest";
import compiledKnowledge from "./knowledge/compiled-knowledge.json";
import { evaluatePolicyGate } from "./policy-gate";
import { retrieveKnowledge } from "./knowledge-retrieval";

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
  });

  it("returns no facts when the gate blocks", () => {
    const gate = evaluatePolicyGate({ message: "I want a refund", knowledge: compiledKnowledge });
    expect(retrieveKnowledge({ gate, knowledge: compiledKnowledge })).toEqual({ rules: [], examples: [] });
  });
});
