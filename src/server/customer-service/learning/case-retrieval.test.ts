import { describe, expect, it } from "vitest";
import { scoreCaseMemory } from "./case-retrieval";

describe("case memory retrieval scoring", () => {
  const current = {
    intent: "design_process",
    riskClass: "low" as const,
    productCategory: "canvas",
    market: "NZ" as const,
    policyReferences: ["design-rules"],
    query: "photos wording theme design draft",
    now: new Date("2026-08-18T00:00:00.000Z"),
  };
  const memory = {
    intent: "design_process",
    riskClass: "low" as const,
    productCategory: "canvas",
    market: "NZ" as const,
    policyReferences: ["design-rules"],
    normalizedSituation: "customer asks how photos and wording become a design draft",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
  };

  it("returns auditable components for a compatible case", () => {
    expect(scoreCaseMemory({ current, memory })).toMatchObject({
      eligible: true,
      totalScore: expect.any(Number),
      components: { intent: 35, policy: 20, product: 10, market: 5, risk: 5 },
    });
    expect(scoreCaseMemory({ current, memory }).totalScore).toBeGreaterThanOrEqual(70);
  });

  it.each([
    ["intent", { intent: "photo_quality" }],
    ["policy", { policyReferences: ["unknown-policy"] }],
    ["product", { productCategory: "roll_up_banner" }],
    ["market", { market: "AU" as const }],
  ])("fails closed on incompatible %s", (_label, override) => {
    expect(scoreCaseMemory({ current, memory: { ...memory, ...override } })).toMatchObject({ eligible: false });
  });

  it("keeps recency bounded to five points", () => {
    const score = scoreCaseMemory({ current, memory: { ...memory, createdAt: current.now } });
    expect(score.components.recency).toBe(5);
    expect(score.totalScore).toBeLessThanOrEqual(100);
  });
});
