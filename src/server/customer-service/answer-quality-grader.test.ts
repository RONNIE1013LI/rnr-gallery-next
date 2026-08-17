import { describe, expect, it } from "vitest";
import compiledKnowledge from "./knowledge/compiled-knowledge.json";
import { gradeAnswerQuality } from "./answer-quality-grader";

describe("answer quality grader", () => {
  it("rewards complete, specific and actionable product guidance", () => {
    const result = gradeAnswerQuality({
      intent: "product_differences",
      draft: [
        "Canvas is a premium wall keepsake on a wooden frame, while a wall banner is flexible and hangs with eyelets.",
        "A roll-up banner is freestanding and uses its own stand, so it is best when no wall is available.",
        "Will it be displayed on a wall or freestanding?",
      ].join("\n"),
      guide: compiledKnowledge.qualityGuides.product_differences,
    });

    expect(result.requiredPointCoverage).toBe(1);
    expect(result.productSpecificity).toBe(1);
    expect(result.usefulNextStep).toBe(true);
    expect(result.unsupportedClaim).toBe(false);
    expect(result.rating).toBe("DIRECTLY_USABLE");
  });

  it("identifies missing required information without weakening policy validation", () => {
    const result = gradeAnswerQuality({
      intent: "photo_guidance",
      draft: "Please send the photo and we can check it.",
      guide: compiledKnowledge.qualityGuides.photo_guidance,
    });

    expect(result.requiredPointCoverage).toBeLessThan(0.9);
    expect(result.missingRequiredPointIds).toEqual(expect.arrayContaining([
      "original_file",
      "enhancement_capability",
      "source_quality_limit",
    ]));
    expect(result.rating).toBe("NEEDS_EDIT");
  });

  it("rejects an unsupported claim using the unchanged output validator", () => {
    const result = gradeAnswerQuality({
      intent: "photo_guidance",
      draft: "We guarantee perfect restoration and print quality.",
      guide: compiledKnowledge.qualityGuides.photo_guidance,
    });

    expect(result.unsupportedClaim).toBe(true);
    expect(result.validatorCodes).toContain("forbidden_commitment");
    expect(result.rating).toBe("REJECTED");
  });

  it("keeps approved natural variants in the compiled quality rules", () => {
    const quotePoint = compiledKnowledge.qualityGuides.quote_information_collection.requiredPoints
      .find((point) => point.id === "quote_next_step");
    const paymentPoint = compiledKnowledge.qualityGuides.payment_process.requiredPoints
      .find((point) => point.id === "design_starts_after_deposit");
    const sourceQualityPoint = compiledKnowledge.qualityGuides.photo_guidance.requiredPoints
      .find((point) => point.id === "source_quality_limit");

    expect(quotePoint?.matchAny).toContain("confirm your quote");
    expect(paymentPoint?.matchAny).toContain("starts the design work");
    expect(sourceQualityPoint?.matchAny).toContain("depend on the originals");
  });
});
