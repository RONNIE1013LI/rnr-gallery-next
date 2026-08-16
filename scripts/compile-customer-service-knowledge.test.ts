import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileCustomerServiceKnowledge } from "./compile-customer-service-knowledge";

const sourceDir = join(process.cwd(), "customer-service-knowledge");

function copyKnowledge() {
  const target = mkdtempSync(join(tmpdir(), "rnr-knowledge-"));
  cpSync(sourceDir, target, { recursive: true });
  return target;
}

describe("customer service knowledge compiler", () => {
  it("normalizes policy evidence, risk and realtime dimensions", () => {
    const result = compileCustomerServiceKnowledge(sourceDir);

    expect(result.rules.find((rule) => rule.id === "DESIGN-04")).toMatchObject({
      evidenceStatus: "CONFIRMED",
      highRisk: false,
      realtimeRequired: true,
      mayAnswerAutomatically: true,
    });
    expect(result.rules.find((rule) => rule.id === "REFUND-01")).toMatchObject({
      evidenceStatus: "UNRESOLVED",
      highRisk: true,
      mayAnswerAutomatically: false,
    });
    expect(result.answerableFacts).not.toContain(
      expect.stringContaining("Custom orders become non-refundable"),
    );
    expect(result.knowledgeVersion).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces deterministic output and maps reply examples", () => {
    const first = compileCustomerServiceKnowledge(sourceDir);
    const second = compileCustomerServiceKnowledge(sourceDir);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.replyExamples[0]).toMatchObject({
      intent: "product_format",
      customer: "Which product format should I choose?",
    });
  });

  it("rejects duplicate policy rules", () => {
    const target = copyKnowledge();
    const policyPath = join(target, "policy-source-map.md");
    const policy = readFileSync(policyPath, "utf8");
    const row = policy.split("\n").find((line) => line.startsWith("| VOICE-01 |"));
    writeFileSync(policyPath, `${policy}\n${row}\n`);

    expect(() => compileCustomerServiceKnowledge(target)).toThrow("Duplicate policy rule: VOICE-01");
  });

  it("rejects unknown policy status and invalid reply JSONL", () => {
    const unknownStatus = copyKnowledge();
    const policyPath = join(unknownStatus, "policy-source-map.md");
    writeFileSync(
      policyPath,
      readFileSync(policyPath, "utf8").replace("| CONFIRMED |", "| ASSUMED |"),
    );
    expect(() => compileCustomerServiceKnowledge(unknownStatus)).toThrow("Unknown policy status");

    const invalidJsonl = copyKnowledge();
    writeFileSync(join(invalidJsonl, "reply-examples.jsonl"), "{not-json}\n");
    expect(() => compileCustomerServiceKnowledge(invalidJsonl)).toThrow("Invalid reply example JSONL at line 1");
  });
});
