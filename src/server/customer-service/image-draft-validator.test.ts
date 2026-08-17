import { describe, expect, it } from "vitest";
import { validateImageDraft } from "./image-draft-validator";

describe("image draft validator", () => {
  it.each([
    ["We will restore this photo.", "visual_restoration_claim"],
    ["We can definitely fix the damage.", "visual_restoration_claim"],
    ["Your photo will be fully restored.", "visual_restoration_claim"],
    ["We can certainly repair it.", "visual_restoration_claim"],
    ["We can fully restore this photo.", "visual_restoration_claim"],
    ["This image is perfect for printing.", "visual_print_suitability_claim"],
    ["This image is ideal for printing.", "visual_print_suitability_claim"],
    ["It will print perfectly.", "visual_print_suitability_claim"],
    ["Print quality is guaranteed.", "visual_print_suitability_claim"],
    ["This photo is suitable for print.", "visual_print_suitability_claim"],
    ["This photo is ready to print.", "visual_print_suitability_claim"],
  ])("blocks unsupported visual claim: %s", (draft, code) => {
    expect(validateImageDraft(draft)).toEqual({ ok: false, codes: [code] });
  });

  it("returns both additive codes when both visual claim classes appear", () => {
    expect(validateImageDraft("We will restore it and this image is perfect for printing.")).toEqual({
      ok: false,
      codes: ["visual_restoration_claim", "visual_print_suitability_claim"],
    });
  });

  it("accepts advisory wording that asks for human assessment", () => {
    expect(validateImageDraft("Please send the original file so we can assess the visible quality.")).toEqual({
      ok: true,
      codes: [],
    });
  });
});
