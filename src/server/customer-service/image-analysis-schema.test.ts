import { describe, expect, it } from "vitest";
import {
  ImageAnalysisResultSchema,
  parseImageAnalysisResult,
  renderImageAnalysisSafeSummary,
} from "./image-analysis-schema";

const validResult = {
  schemaVersion: "1",
  overallStatus: "assessed",
  images: [{
    ordinal: 1,
    classification: "screenshot_of_photo",
    blur: "mild",
    sourceResolutionSignal: "low",
    subjectScale: "usable",
    crop: "none_visible",
    obstruction: "none_visible",
    screenshotSignal: "likely",
    recommendedRole: "main_candidate",
    issueCodes: ["request_original"],
  }],
  comparison: {
    likelyMainOrdinal: 1,
    likelySideOrdinals: [],
    confidence: "medium",
    reasonCodes: ["larger_subject"],
  },
  recommendationCodes: ["send_original_file", "use_as_main_candidate"],
  safeSummary: "Image 1 appears to be a screenshot; request the original file.",
} as const;

describe("ImageAnalysisResultSchema", () => {
  it("accepts the approved image-analysis contract", () => {
    expect(ImageAnalysisResultSchema.parse(validResult)).toEqual(validResult);
  });

  it.each([
    ["top-level", { ...validResult, unexpected: true }],
    ["image", { ...validResult, images: [{ ...validResult.images[0], unexpected: true }] }],
    ["comparison", { ...validResult, comparison: { ...validResult.comparison, unexpected: true } }],
  ])("rejects unknown keys on the %s object", (_label, candidate) => {
    expect(() => ImageAnalysisResultSchema.parse(candidate)).toThrow();
  });

  it.each([
    ["percentage", "confidencePercent", 95],
    ["identity", "identity", "Jane Doe"],
    ["age", "age", "young"],
    ["ethnicity", "ethnicity", "unknown"],
    ["health", "health", "healthy"],
    ["emotion", "emotion", "happy"],
    ["attractiveness", "attractiveness", "attractive"],
    ["price", "price", "$100"],
    ["ETA", "eta", "tomorrow"],
    ["restoration success", "restorationSuccess", true],
    ["print suitability", "printSuitable", true],
  ])("rejects forbidden %s fields", (_label, key, value) => {
    const candidate = {
      ...validResult,
      images: [{ ...validResult.images[0], [key]: value }],
    };

    expect(() => ImageAnalysisResultSchema.parse(candidate)).toThrow();
  });

  it("rejects values outside the approved enums", () => {
    const candidate = {
      ...validResult,
      images: [{ ...validResult.images[0], classification: "portrait" }],
    };

    expect(() => ImageAnalysisResultSchema.parse(candidate)).toThrow();
  });

  it("rejects more than five images", () => {
    const images = Array.from({ length: 6 }, (_, index) => ({
      ...validResult.images[0],
      ordinal: index + 1,
    }));

    expect(() => ImageAnalysisResultSchema.parse({ ...validResult, images })).toThrow();
  });

  it("rejects response ordinals that do not exactly match submitted attachments", () => {
    expect(() => parseImageAnalysisResult(validResult, [1, 2])).toThrow("image_analysis_ordinal_mismatch");
  });

  it("accepts an exact zero-based submitted attachment set", () => {
    const candidate = {
      ...validResult,
      images: [{ ...validResult.images[0], ordinal: 0 }],
      comparison: { ...validResult.comparison, likelyMainOrdinal: 0 },
      safeSummary: "Image 0 appears to be a screenshot; request the original file.",
    };

    expect(parseImageAnalysisResult(candidate, [0])).toEqual(candidate);
  });

  it("preserves exact submitted-set isolation for zero-based results", () => {
    const candidate = {
      ...validResult,
      images: [{ ...validResult.images[0], ordinal: 0 }],
      comparison: { ...validResult.comparison, likelyMainOrdinal: 0 },
      safeSummary: "Image 0 appears to be a screenshot; request the original file.",
    };

    expect(() => parseImageAnalysisResult(candidate, [1])).toThrow("image_analysis_ordinal_mismatch");
  });

  it("rejects comparison ordinals outside the submitted attachment set", () => {
    const candidate = {
      ...validResult,
      comparison: {
        ...validResult.comparison,
        likelySideOrdinals: [2],
      },
    };

    expect(() => parseImageAnalysisResult(candidate, [1])).toThrow("image_analysis_ordinal_mismatch");
  });

  it("renders only validated codes instead of model-written summary prose", () => {
    const candidate = {
      ...validResult,
      safeSummary: "Jane looks happy and this will definitely print well for $100 tomorrow.",
    };

    expect(renderImageAnalysisSafeSummary(candidate)).toBe(
      "Image 1 appears to be a screenshot; request the original file.",
    );
    expect(() => ImageAnalysisResultSchema.parse(candidate)).toThrow();
  });

  it("renders actionable recommendation codes when no image issue code is present", () => {
    const candidate = {
      ...validResult,
      images: [{ ...validResult.images[0], issueCodes: [] }],
      comparison: null,
      recommendationCodes: ["send_uncropped_version"],
      safeSummary: "model prose is discarded",
    };

    expect(renderImageAnalysisSafeSummary(candidate)).toBe("Request an uncropped image version.");
  });

  it("renders a zero-based main-candidate ordinal", () => {
    const candidate = {
      ...validResult,
      images: [{
        ...validResult.images[0],
        ordinal: 0,
        issueCodes: [],
        recommendedRole: "main_candidate",
      }],
      comparison: {
        ...validResult.comparison,
        likelyMainOrdinal: 0,
      },
      recommendationCodes: ["use_as_main_candidate"],
      safeSummary: "model prose is discarded",
    };

    expect(renderImageAnalysisSafeSummary(candidate)).toBe("Image 0 is the likely main candidate.");
  });
});
