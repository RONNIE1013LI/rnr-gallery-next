import { describe, expect, it } from "vitest";
import canonicalSource from "../src/server/rnr-ai/business-brain/rnr-business-brain.v0.5.1.json";
import { compileBusinessBrain, type BusinessBrainSource } from "./compile-rnr-business-brain";

function validSource(): BusinessBrainSource {
  return {
    version: "0.5.1",
    effectiveDate: "2026-09-04",
    rules: [
      {
        id: "au-photo-canvas-a4",
        status: "CONFIRMED",
        market: "AU",
        category: "pricing",
        statement: "Photo Print Canvas A4 is A$69.99.",
        provenance: "Owner-supplied AU price book, 2026-09-04",
        autonomous: true,
        requiresLiveTool: false,
        currency: "AUD",
      },
      {
        id: "refund-policy",
        status: "REVIEW",
        market: "GLOBAL",
        category: "policy",
        statement: "Refund wording requires owner approval.",
        provenance: "R&R Business Brain v0.5.1 section 6.3",
        autonomous: false,
        requiresLiveTool: false,
      },
    ],
    riskRules: [{
      id: "refund-risk",
      risk: "RED",
      triggers: ["refund", "chargeback"],
      action: "Human review; do not approve money movement.",
    }],
    voice: {
      style: ["Friendly but concise"],
      avoid: ["Unsupported promises"],
      responsePattern: "Direct answer, useful detail, one next step if needed.",
    },
    reviewItems: ["refund-policy"],
  };
}

describe("compileBusinessBrain", () => {
  it("keeps all eleven owner-review items non-autonomous", () => {
    const compiled = compileBusinessBrain(canonicalSource as BusinessBrainSource);
    const reviewRules = compiled.rules.filter((rule) => compiled.reviewItems.includes(rule.id));

    expect(compiled.reviewItems).toHaveLength(11);
    expect(reviewRules).toHaveLength(11);
    expect(reviewRules.every((rule) => rule.status === "REVIEW" && !rule.autonomous)).toBe(true);
  });

  it("sorts stable IDs and produces a deterministic source hash", () => {
    const source = validSource();
    source.rules.reverse();

    const first = compileBusinessBrain(source);
    const second = compileBusinessBrain(source);

    expect(first.rules.map((rule) => rule.id)).toEqual(["au-photo-canvas-a4", "refund-policy"]);
    expect(first).toEqual(second);
    expect(first.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects duplicate rule IDs", () => {
    const source = validSource();
    source.rules.push({ ...source.rules[0] });
    expect(() => compileBusinessBrain(source)).toThrow(/duplicate rule id/i);
  });

  it("rejects currency from the wrong market", () => {
    const source = validSource();
    source.rules[0] = { ...source.rules[0], currency: "NZD" };
    expect(() => compileBusinessBrain(source)).toThrow(/currency.*market/i);
  });

  it.each([
    ["version", "0.5.0"],
    ["effectiveDate", "2026-09-05"],
  ] as const)("rejects an invalid %s", (key, value) => {
    expect(() => compileBusinessBrain({ ...validSource(), [key]: value })).toThrow();
  });

  it("rejects missing provenance", () => {
    const source = validSource();
    source.rules[0] = { ...source.rules[0], provenance: "" };
    expect(() => compileBusinessBrain(source)).toThrow(/provenance/i);
  });

  it("rejects REVIEW facts marked autonomous", () => {
    const source = validSource();
    source.rules[1] = { ...source.rules[1], autonomous: true };
    expect(() => compileBusinessBrain(source)).toThrow(/review.*autonomous/i);
  });

  it("rejects historical examples elevated into hard facts", () => {
    const source = validSource();
    source.rules[0] = {
      ...source.rules[0],
      provenance: "Historical customer quote from 2025",
    };
    expect(() => compileBusinessBrain(source)).toThrow(/historical.*confirmed/i);
  });
});
