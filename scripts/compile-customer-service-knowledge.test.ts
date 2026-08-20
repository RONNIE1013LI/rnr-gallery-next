import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileCustomerServiceKnowledge, resolveSourceCommit } from "./compile-customer-service-knowledge";

const sourceDir = join(process.cwd(), "customer-service-knowledge");

function copyKnowledge() {
  const target = mkdtempSync(join(tmpdir(), "rnr-knowledge-"));
  cpSync(sourceDir, target, { recursive: true });
  return target;
}

describe("customer service knowledge compiler", () => {
  it("uses Vercel's source commit when the build has no git directory", () => {
    const gitFallback = () => { throw new Error("git unavailable"); };

    expect(resolveSourceCommit({ VERCEL_GIT_COMMIT_SHA: "vercel-commit-123" }, gitFallback)).toBe(
      "vercel-commit-123",
    );
  });

  it("uses the checked artifact commit when CLI deployment has no git metadata", () => {
    const gitFallback = () => { throw new Error("git unavailable"); };

    expect(resolveSourceCommit({}, gitFallback, "artifact-commit-456")).toBe("artifact-commit-456");
  });
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
    expect(result.rules.find((rule) => rule.id === "AI-SCOPE-03")).toMatchObject({
      evidenceStatus: "CONFIRMED",
      mayAnswerAutomatically: true,
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

  it("records deterministic source provenance without changing the semantic version", () => {
    const metadata = { sourceCommit: "abc1234", compiledAt: "2026-08-20T00:00:00.000Z" };
    const first = compileCustomerServiceKnowledge(sourceDir, metadata);
    const second = compileCustomerServiceKnowledge(sourceDir, metadata);

    expect(first.knowledgeVersion).toBe(second.knowledgeVersion);
    expect(first.metadata).toEqual(expect.objectContaining({
      buildVersion: "1",
      sourceCommit: "abc1234",
      compiledAt: "2026-08-20T00:00:00.000Z",
      sourceChecksum: expect.stringMatching(/^[a-f0-9]{64}$/),
      sourceCounts: {
        policyRules: 58,
        replyExamples: 20,
        goldenReplies: 20,
        historicalExamples: 20,
        approvedHistoricalExamples: 8,
        qualityGuides: 7,
      },
    }));
  });

  it("changes the source checksum when a governed source changes", () => {
    const target = copyKnowledge();
    const metadata = { sourceCommit: "abc1234", compiledAt: "2026-08-20T00:00:00.000Z" };
    const before = compileCustomerServiceKnowledge(target, metadata);
    writeFileSync(join(target, "tone-guide.md"), `${readFileSync(join(target, "tone-guide.md"), "utf8")}\nNew governed guidance.\n`);
    const after = compileCustomerServiceKnowledge(target, metadata);

    expect(after.metadata.sourceChecksum).not.toBe(before.metadata.sourceChecksum);
    expect(after.knowledgeVersion).not.toBe(before.knowledgeVersion);
  });

  it("compiles Ronnie-approved golden replies and intent quality guides", () => {
    const result = compileCustomerServiceKnowledge(sourceDir);

    expect(result.goldenReplies).toHaveLength(20);
    expect(result.goldenReplies.find((reply) => reply.id === "product-01")).toMatchObject({
      intent: "product_differences",
      customerQuestion: "Which product format should I choose?",
      reviewOutcome: "NEEDS_EDIT",
      requiredInformationPoints: expect.arrayContaining(["display_method", "product_use_cases"]),
      relatedKnowledgeSources: expect.arrayContaining(["AI-SCOPE-02", "PRODUCT-04"]),
    });
    expect(result.goldenReplies.every((reply) => (
      reply.approvedAnswer.length > 0
      && reply.forbiddenClaims.length > 0
      && reply.toneCharacteristics.length > 0
    ))).toBe(true);
    expect(result.qualityGuides.product_differences).toMatchObject({
      intent: "product_differences",
      preferredStructure: expect.any(Array),
      usefulFollowUpQuestions: expect.any(Array),
      forbiddenClaims: expect.arrayContaining([expect.stringContaining("price")]),
    });
    expect(result.qualityGuides.design_process.requiredPoints.map((point) => point.id)).toEqual(
      expect.arrayContaining(["design_inputs", "draft_review", "approval_to_production"]),
    );
  });

  it("compiles only approved reusable historical examples", () => {
    const result = compileCustomerServiceKnowledge(sourceDir);

    expect(result.historicalExamples.length).toBeGreaterThan(0);
    expect(result.historicalExamples.every((example) => example.status === "APPROVED_REUSABLE")).toBe(true);
    expect(result.historicalExamples).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "legacy-product-format-01",
        intent: "product_differences",
        policyReferences: expect.arrayContaining(["AI-SCOPE-02"]),
      }),
    ]));
    expect(result.historicalExamples.some((example) => example.id === "legacy-refund-18")).toBe(false);
  });

  it("rejects unsafe approved historical examples", () => {
    const cases = [
      {
        id: "high risk",
        record: {
          id: "unsafe-01", intent: "tone_adjustment", status: "APPROVED_REUSABLE",
          customer_question: "Can I get a refund?", approved_answer: "We will refund your order.",
          policy_references: ["AI-SCOPE-01"], provenance: "test",
        },
        error: "high-risk content",
      },
      {
        id: "realtime fact",
        record: {
          id: "unsafe-02", intent: "quote_information_collection", status: "APPROVED_REUSABLE",
          customer_question: "What should I send?", approved_answer: "The current price is $189.75.",
          policy_references: ["AI-SCOPE-03"], provenance: "test",
        },
        error: "realtime fact",
      },
      {
        id: "non-confirmed policy",
        record: {
          id: "unsafe-03", intent: "revision_policy", status: "APPROVED_REUSABLE",
          customer_question: "How many revisions?", approved_answer: "Two revisions are included.",
          policy_references: ["DESIGN-02"], provenance: "test",
        },
        error: "non-confirmed rule",
      },
    ] as const;

    for (const item of cases) {
      const target = copyKnowledge();
      writeFileSync(join(target, "historical-examples.jsonl"), `${JSON.stringify(item.record)}\n`);
      expect(
        () => compileCustomerServiceKnowledge(target),
        item.id,
      ).toThrow(item.error);
    }
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
