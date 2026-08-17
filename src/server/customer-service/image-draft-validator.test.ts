import { describe, expect, it } from "vitest";
import { validateImageDraft } from "./image-draft-validator";

describe("image draft validator", () => {
  it.each([
    ["We will restore this photo.", "visual_restoration_claim"],
    ["We can definitely fix the damage.", "visual_restoration_claim"],
    ["Your photo will be fully restored.", "visual_restoration_claim"],
    ["We can certainly repair it.", "visual_restoration_claim"],
    ["We can fully restore this photo.", "visual_restoration_claim"],
    ["This photo can be fully restored.", "visual_restoration_claim"],
    ["A full restoration is guaranteed.", "visual_restoration_claim"],
    ["This image is perfect for printing.", "visual_print_suitability_claim"],
    ["This image is ideal for printing.", "visual_print_suitability_claim"],
    ["It will print perfectly.", "visual_print_suitability_claim"],
    ["Print quality is guaranteed.", "visual_print_suitability_claim"],
    ["This photo is suitable for print.", "visual_print_suitability_claim"],
    ["This photo is ready to print.", "visual_print_suitability_claim"],
    ["This photo will be perfect for printing.", "visual_print_suitability_claim"],
    ["This photo looks suitable for print.", "visual_print_suitability_claim"],
    ["This file is perfect for printing.", "visual_print_suitability_claim"],
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

  it("accepts advisory print and restoration wording without a definitive promise", () => {
    expect(validateImageDraft(
      "We can review whether the file may be suitable for printing and assess what restoration is possible.",
    )).toEqual({ ok: true, codes: [] });
  });

  it.each([
    "We need to assess whether this photo can be fully restored.",
    "We need to assess whether this photo is suitable for print.",
    "We cannot confirm this photo is suitable for print without reviewing the original.",
    "We cannot say we will restore it.",
    "We cannot guarantee that this photo can be fully restored.",
    "It is not yet possible to say whether this file will be perfect for printing.",
    "Could this file be suitable for printing?",
    "Whether this photo can be fully restored depends on assessing the original file.",
    "Whether this photo is suitable for print depends on reviewing the original file.",
  ])("accepts assessment-dependent or explicitly withheld claim: %s", (draft) => {
    expect(validateImageDraft(draft)).toEqual({ ok: true, codes: [] });
  });

  it("still blocks a definitive claim in a contrast clause", () => {
    expect(validateImageDraft(
      "We cannot confirm the source resolution, but this photo is suitable for print.",
    )).toEqual({ ok: false, codes: ["visual_print_suitability_claim"] });
    expect(validateImageDraft(
      "Although we cannot confirm the source resolution, this photo is suitable for print.",
    )).toEqual({ ok: false, codes: ["visual_print_suitability_claim"] });
    expect(validateImageDraft(
      "We cannot confirm the source resolution and this photo is suitable for print.",
    )).toEqual({ ok: false, codes: ["visual_print_suitability_claim"] });
  });
});
