import { describe, expect, it } from "vitest";
import { validateImageDraft } from "./image-draft-validator";

const adversarialUnsafeClaims = [
  // Restoration capability
  ["restoration/causative result", "We can make this damaged photo look new again.", "visual_restoration_claim"],
  ["restoration/copular capability", "Our team is capable of restoring this picture.", "visual_restoration_claim"],
  ["restoration/promise residual", "We promise to restore your photo.", "visual_restoration_claim"],
  ["restoration/promise paraphrase", "We assure you that this image will be repaired.", "visual_restoration_claim"],
  ["restoration/synonym", "We will recover the faded image.", "visual_restoration_claim"],
  ["restoration/morphological", "This photo is restorable.", "visual_restoration_claim"],
  ["restoration/morphological synonym", "This picture is fully repairable.", "visual_restoration_claim"],
  ["restoration/compound", "We'll bring your photo back to its original condition.", "visual_restoration_claim"],

  // Print readiness and suitability, including all five I6 residual probes.
  ["print/causative residual", "We can make this photo ready for printing.", "visual_print_suitability_claim"],
  ["print/copular residual", "Your photo is print-ready.", "visual_print_suitability_claim"],
  ["print/causative promise residual", "We will make your image ready to print.", "visual_print_suitability_claim"],
  ["print/copular compound residual", "The image is print ready.", "visual_print_suitability_claim"],
  ["print/causative paraphrase", "We'll get this picture ready for print.", "visual_print_suitability_claim"],
  ["print/promise", "We promise your photo will be suitable for printing.", "visual_print_suitability_claim"],
  ["print/synonym", "This file meets print-quality requirements.", "visual_print_suitability_claim"],
  ["print/morphological", "This image is printable.", "visual_print_suitability_claim"],
  ["print/compound", "This is a print-quality image.", "visual_print_suitability_claim"],
  ["print/compound synonym", "Your picture is press-ready.", "visual_print_suitability_claim"],

  // Guaranteed enhancement
  ["enhancement/copular guarantee", "Photo enhancement is guaranteed.", "visual_restoration_claim"],
  ["enhancement/causative guarantee", "We guarantee we can make this blurry image clear.", "visual_restoration_claim"],
  ["enhancement/promise", "We promise to enhance your photo.", "visual_restoration_claim"],
  ["enhancement/synonym guarantee", "We guarantee a sharper, clearer picture.", "visual_restoration_claim"],
  ["enhancement/morphological", "Your photo will be professionally enhanced.", "visual_restoration_claim"],
  ["enhancement/compound", "We can definitely upscale this low-resolution image.", "visual_restoration_claim"],
  ["enhancement/synonym", "We will improve the quality of your picture.", "visual_restoration_claim"],

  // Missing-detail reconstruction
  ["detail/copular capability", "The missing details are recoverable.", "visual_restoration_claim"],
  ["detail/causative", "We can make the missing parts visible again.", "visual_restoration_claim"],
  ["detail/promise", "We promise to reconstruct the missing details.", "visual_restoration_claim"],
  ["detail/synonym", "We will recreate the lost parts of the photo.", "visual_restoration_claim"],
  ["detail/morphological", "The obscured detail can be reconstructed.", "visual_restoration_claim"],
  ["detail/compound", "We can fill in every missing detail.", "visual_restoration_claim"],
  ["detail/compound synonym", "We will rebuild the missing background.", "visual_restoration_claim"],
] as const;

const adversarialAllowedClaims = [
  // Uncertainty
  ["uncertain restoration", "We may be able to restore this photo."],
  ["uncertain printability", "This photo might be printable."],
  ["uncertain enhancement", "We may be able to enhance the image after review."],
  ["uncertain reconstruction", "It may be possible to reconstruct some missing detail."],

  // Conditional assessment
  ["assess restoration", "We need to assess whether this photo is restorable."],
  ["review print readiness", "We can review whether the image is ready for printing."],
  ["check enhancement", "We need to check whether enhancement could improve the image."],
  ["assess reconstruction", "We need to assess whether any missing detail can be reconstructed."],

  // Explicit negation
  ["negated restoration promise", "We cannot promise to restore your photo."],
  ["negated print readiness", "This image is not print-ready."],
  ["negated enhancement guarantee", "Enhancement is not guaranteed."],
  ["negated reconstruction", "We cannot reconstruct missing details."],

  // Questions
  ["restoration question", "Can this photo be restored?"],
  ["print-readiness question", "Is your image ready for printing?"],
  ["enhancement question", "Can enhancement make this image clearer?"],
  ["reconstruction question", "Can the missing details be reconstructed?"],

  // Original-file assessment requests
  ["original for print review", "Please send the original file so we can assess whether it is ready for printing."],
  ["original for restoration review", "Please send the original photo so we can check what restoration is possible."],
  ["original for enhancement review", "Please send the original image so we can determine whether enhancement may help."],
  ["original for detail review", "Please send the original file so we can assess whether any missing details can be recovered."],

  // Source-quality dependency
  ["restoration source dependency", "Whether this photo can be restored depends on source quality."],
  ["print source dependency", "Print readiness depends on the source quality."],
  ["enhancement source dependency", "How much enhancement is possible depends on source quality."],
  ["detail source dependency", "Whether missing details can be reconstructed depends on the source quality."],

  // Related wording that does not certify the supplied image.
  ["format guidance", "The print-ready PDF is the final artwork format."],
  ["service description", "Our restoration service requires the original file."],
] as const;

const reviewerUnsafeClaims = [
  ["restoration/contraction", "We'll enhance your photo.", "visual_restoration_claim"],
  ["restoration/curly contraction", "We’ll restore your photo to its original condition.", "visual_restoration_claim"],
  ["restoration/role causative", "Ronnie can make this damaged photo look new again.", "visual_restoration_claim"],
  ["restoration/plural morphology", "These photos are restorable.", "visual_restoration_claim"],
  ["restoration/synonym", "Our designer will sharpen the image.", "visual_restoration_claim"],
  ["print/plural copular", "Your photos are print-ready.", "visual_print_suitability_claim"],
  ["print/contraction", "It'll be ready for printing.", "visual_print_suitability_claim"],
  ["print/subject synonym", "This photograph will print beautifully.", "visual_print_suitability_claim"],
  ["print/causative synonym", "We can prepare this photo for print.", "visual_print_suitability_claim"],
  ["print/suitability synonym", "The image resolution is sufficient for printing.", "visual_print_suitability_claim"],
  ["enhancement/guarantee", "We guarantee better image quality.", "visual_restoration_claim"],
  ["enhancement/copular guarantee", "Your photo is guaranteed to look sharper.", "visual_restoration_claim"],
  ["enhancement/curly promise", "We’ll upscale this low-resolution photo.", "visual_restoration_claim"],
  ["detail/contraction", "We'll reconstruct the missing details.", "visual_restoration_claim"],
  ["detail/facial morphology", "We can reconstruct every missing facial feature.", "visual_restoration_claim"],
  ["detail/synonym", "Our designer will add back the missing details.", "visual_restoration_claim"],
  ["detail/copular synonym", "The absent background can be rebuilt.", "visual_restoration_claim"],
  ["compound embedded assertion", "Could you send the original because your photo is print-ready?", "visual_print_suitability_claim"],
] as const;

const systematicUnsafeClaims = [
  ["restoration/first-person contraction", "I'll recover this picture.", "visual_restoration_claim"],
  ["restoration/noun synonym", "This photograph is repairable.", "visual_restoration_claim"],
  ["restoration/described subject", "The uploaded image can be fully restored.", "visual_restoration_claim"],
  ["restoration/passive compound", "The photo can be brought back to its original condition.", "visual_restoration_claim"],
  ["restoration/curly copular contraction", "We’re able to restore this photo.", "visual_restoration_claim"],
  ["print/plural suitability", "These images are suitable for printing.", "visual_print_suitability_claim"],
  ["print/described subject", "The uploaded photo is ready for print.", "visual_print_suitability_claim"],
  ["print/curly contraction", "It’s printable.", "visual_print_suitability_claim"],
  ["print/causative alternate purpose", "We can make the photo suitable to print.", "visual_print_suitability_claim"],
  ["print/standards synonym", "This picture meets printing standards.", "visual_print_suitability_claim"],
  ["print/good-enough synonym", "This file is good enough to print.", "visual_print_suitability_claim"],
  ["print/resolution synonym", "This file has enough resolution for printing.", "visual_print_suitability_claim"],
  ["enhancement/contraction target", "We'll enhance this image.", "visual_restoration_claim"],
  ["enhancement/sharpen synonym", "We will sharpen your picture.", "visual_restoration_claim"],
  ["enhancement/quality result", "The photo's quality will improve.", "visual_restoration_claim"],
  ["enhancement/assured noun", "A flawless enhancement is assured.", "visual_restoration_claim"],
  ["enhancement/clean-up synonym", "We can clean up this blurry photo.", "visual_restoration_claim"],
  ["detail/curly contraction", "We’ll recover the missing facial details.", "visual_restoration_claim"],
  ["detail/passive feature", "Every lost feature will be recreated.", "visual_restoration_claim"],
  ["detail/generate synonym", "We can generate the missing details.", "visual_restoration_claim"],
  ["detail/postpositive missing", "We can restore detail that is missing.", "visual_restoration_claim"],
  ["compound now-that question", "Can you approve the size now that this image is print-ready?", "visual_print_suitability_claim"],
  ["compound assessment boundary", "We can assess whether you prefer matte before this photo is print-ready.", "visual_print_suitability_claim"],
  ["compound negation boundary", "We cannot guarantee the colours yet this photo is print-ready.", "visual_print_suitability_claim"],
] as const;

const reviewerSafeControls = [
  ["uncertainty", "It is unclear whether this photo is printable."],
  ["uncertainty", "We are unsure whether the image can be restored."],
  ["uncertainty", "We may be able to enhance the image after reviewing the original."],
  ["assessment", "We need to inspect whether this photo is printable."],
  ["assessment", "Our designer will evaluate whether this photo is printable."],
  ["assessment/original", "Please upload the original so we can tell you if it is suitable for printing."],
  ["negation", "We won't promise that this image is print-ready."],
  ["negation", "We don't claim this photo is printable."],
  ["negation", "We cannot assure you that the photo is print-ready."],
  ["question", "Can this photo be restored?"],
  ["question", "Would these photos be printable?"],
  ["original", "Please send the original image and we'll let you know whether enhancement is possible."],
  ["original", "Please send the original so our designer can tell you whether it is printable."],
] as const;

const systematicSafeControls = [
  ["uncertainty/negation", "The photo may not be printable."],
  ["assessment/see", "We'll look at the original to see whether the image is printable."],
  ["negation/copular", "This photo is not printable."],
  ["negation/capability", "We are not able to restore this photo."],
  ["question/detail", "Can the missing facial details be reconstructed?"],
  ["original/check", "Please send the original photo so we can check what restoration is possible."],
  ["original/let-know", "Please send the original photo and we'll let you know what restoration is possible."],
  ["ordinary/original", "For best quality, please send the original high-resolution photo."],
  ["ordinary/assessment", "We can review the photo quality and let you know what may be possible after checking it."],
  ["ordinary/file quality", "The original file gives us the best quality to work with."],
  ["ordinary/design enhancement", "We can enhance the design with your wording and colours."],
  ["ordinary/layout improvement", "We can improve the layout around your photo."],
] as const;

const ronnieApprovedReplies = [
  ["photo-02", "Hi there, yes, please send through the original photo.\nWe can assess its quality and let you know what we find after reviewing the file. 😊"],
  ["photo-05", "Hi there, thanks for reaching out.\nYes, please send through the original photos, and we can assess whether they’re suitable to combine. 😊"],
  ["photo-08", "Hi there, please send through the original image file rather than a screenshot or edited copy.\nWe can review the photo quality and let you know what may be possible after checking it. 😊"],
] as const;

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
    ["This photo is definitely suitable for print.", "visual_print_suitability_claim"],
    ["This image will absolutely be perfect for printing.", "visual_print_suitability_claim"],
    ["We are able to fully restore this photo.", "visual_restoration_claim"],
    ["We'll restore this photo.", "visual_restoration_claim"],
    ["We can make this photo print-ready.", "visual_print_suitability_claim"],
    ["This photo will print beautifully.", "visual_print_suitability_claim"],
    ["We'll make it suitable for printing.", "visual_print_suitability_claim"],
  ])("blocks unsupported visual claim: %s", (draft, code) => {
    expect(validateImageDraft(draft)).toEqual({ ok: false, codes: [code] });
  });

  it.each(adversarialUnsafeClaims)("blocks $0: $1", (_form, draft, code) => {
    expect(validateImageDraft(draft)).toEqual({ ok: false, codes: [code] });
  });

  it.each(reviewerUnsafeClaims)("blocks reviewer probe $0: $1", (_form, draft, code) => {
    expect(validateImageDraft(draft)).toEqual({ ok: false, codes: [code] });
  });

  it.each(systematicUnsafeClaims)("blocks systematic variant $0: $1", (_form, draft, code) => {
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
    "We need to assess if this photo can be fully restored.",
    "We cannot yet confirm this photo is suitable for print.",
    "We do not know whether this photo can be fully restored.",
    "We may be able to restore this photo.",
    "We will not be able to restore this photo.",
    "It may be possible that we will be able to restore this photo.",
    "We probably will be able to restore this photo.",
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

  it.each(adversarialAllowedClaims)("accepts $0: $1", (_form, draft) => {
    expect(validateImageDraft(draft)).toEqual({ ok: true, codes: [] });
  });

  it.each(reviewerSafeControls)("accepts reviewer control $0: $1", (_form, draft) => {
    expect(validateImageDraft(draft)).toEqual({ ok: true, codes: [] });
  });

  it.each(systematicSafeControls)("accepts systematic control $0: $1", (_form, draft) => {
    expect(validateImageDraft(draft)).toEqual({ ok: true, codes: [] });
  });

  it.each(ronnieApprovedReplies)("preserves Ronnie-approved reply %s", (_id, draft) => {
    expect(validateImageDraft(draft)).toEqual({ ok: true, codes: [] });
  });

  it("still blocks a definitive claim in a contrast clause", () => {
    expect(validateImageDraft(
      "We need to assess if restoration is possible because this image is suitable for print.",
    )).toEqual({ ok: false, codes: ["visual_print_suitability_claim"] });
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

  it.each([
    "We need to assess if restoration is possible: this image is suitable for print.",
    "We need to assess if restoration is possible - this image is suitable for print.",
    "We need to assess if restoration is possible \u2013 this image is suitable for print.",
    "We need to assess if restoration is possible \u2014 this image is suitable for print.",
  ])("blocks a definitive claim after a hard punctuation boundary: %s", (draft) => {
    expect(validateImageDraft(draft)).toEqual({
      ok: false,
      codes: ["visual_print_suitability_claim"],
    });
  });
});
