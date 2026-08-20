import { describe, expect, it } from "vitest";
import { classifyHumanEdit } from "./edit-classifier";

describe("human edit classifier", () => {
  it("normalizes punctuation and whitespace for unchanged replies", () => {
    expect(classifyHumanEdit("Please send your postcode 😊", "Please send your postcode! 😊"))
      .toMatchObject({ classification: "accepted_unchanged", similarityScore: 10_000 });
  });

  it("classifies light, significant, ignored and independent replies", () => {
    expect(classifyHumanEdit("Please send your postcode and product.", "Please send your postcode and product type."))
      .toMatchObject({ classification: "edited_light" });
    expect(classifyHumanEdit("Please send your postcode.", "Could you send through the delivery postcode?"))
      .toMatchObject({ classification: "edited_significant" });
    expect(classifyHumanEdit("Please send your postcode.", "Thanks, your artwork is now approved for printing."))
      .toMatchObject({ classification: "ai_ignored" });
    expect(classifyHumanEdit(null, "Please send your postcode."))
      .toMatchObject({ classification: "independent_reply", similarityScore: null });
  });
});
