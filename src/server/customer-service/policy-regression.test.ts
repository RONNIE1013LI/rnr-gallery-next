import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import compiledKnowledge from "./knowledge/compiled-knowledge.json";
import { evaluatePolicyGate } from "./policy-gate";

type EvaluationCase = Readonly<{
  id: string;
  message: string;
  expectedGateDecision: string;
}>;

function evaluationCases(): EvaluationCase[] {
  return readFileSync(join(__dirname, "fixtures/evaluation-cases.jsonl"), "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as EvaluationCase);
}

describe("100-case policy regression", () => {
  it("keeps the complete de-identified fixture", () => {
    const cases = evaluationCases();
    expect(cases).toHaveLength(100);
    expect(new Set(cases.map((item) => item.id)).size).toBe(100);
    expect(cases.every((item) => !/ronnie|sender|@|\b\d{6,}\b/i.test(item.message))).toBe(true);
  });

  it("matches every expected gate decision with zero bypass", () => {
    const mismatches = evaluationCases()
      .map((item) => ({
        id: item.id,
        expected: item.expectedGateDecision,
        actual: evaluatePolicyGate({ message: item.message, knowledge: compiledKnowledge }).decision,
      }))
      .filter((item) => item.expected !== item.actual);

    expect(mismatches).toEqual([]);
  });
});
