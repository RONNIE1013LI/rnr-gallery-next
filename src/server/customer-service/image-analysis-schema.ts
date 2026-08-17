import { z } from "zod";

const CLASSIFICATIONS = [
  "customer_photo",
  "design_reference",
  "screenshot_of_photo",
  "screenshot_of_design",
  "price_or_ad_reference",
  "unknown",
] as const;

const ISSUE_CODES = [
  "request_original",
  "request_uncropped",
  "request_closer_subject",
  "request_less_obstructed",
  "request_alternative",
  "manual_assessment",
] as const;

const RECOMMENDATION_CODES = [
  "send_original_file",
  "send_uncropped_version",
  "send_closer_photo",
  "send_alternative_photo",
  "use_as_main_candidate",
  "use_as_side_candidate",
  "human_review",
] as const;

export type ImageAnalysisResult = Readonly<{
  schemaVersion: "1";
  overallStatus: "assessed" | "unclear" | "human_review_required";
  images: ReadonlyArray<Readonly<{
    ordinal: number;
    classification: typeof CLASSIFICATIONS[number];
    blur: "none_visible" | "mild" | "strong" | "unclear";
    sourceResolutionSignal: "normal" | "low" | "very_low" | "unclear";
    subjectScale: "large" | "usable" | "small" | "very_small" | "unclear";
    crop: "none_visible" | "mild" | "heavy" | "unclear";
    obstruction: "none_visible" | "mild" | "heavy" | "unclear";
    screenshotSignal: "none_visible" | "possible" | "likely" | "unclear";
    recommendedRole: "main_candidate" | "side_candidate" | "reference_only" | "unclear";
    issueCodes: ReadonlyArray<typeof ISSUE_CODES[number]>;
  }>>;
  comparison: Readonly<{
    likelyMainOrdinal: number | null;
    likelySideOrdinals: ReadonlyArray<number>;
    confidence: "low" | "medium";
    reasonCodes: ReadonlyArray<
      | "larger_subject"
      | "less_blur"
      | "less_crop"
      | "less_obstruction"
      | "better_composition"
      | "unclear"
    >;
  }> | null;
  recommendationCodes: ReadonlyArray<typeof RECOMMENDATION_CODES[number]>;
  safeSummary: string;
}>;

const ImageRecordSchema = z.object({
  ordinal: z.number().int().positive(),
  classification: z.enum(CLASSIFICATIONS),
  blur: z.enum(["none_visible", "mild", "strong", "unclear"]),
  sourceResolutionSignal: z.enum(["normal", "low", "very_low", "unclear"]),
  subjectScale: z.enum(["large", "usable", "small", "very_small", "unclear"]),
  crop: z.enum(["none_visible", "mild", "heavy", "unclear"]),
  obstruction: z.enum(["none_visible", "mild", "heavy", "unclear"]),
  screenshotSignal: z.enum(["none_visible", "possible", "likely", "unclear"]),
  recommendedRole: z.enum(["main_candidate", "side_candidate", "reference_only", "unclear"]),
  issueCodes: z.array(z.enum(ISSUE_CODES)),
}).strict();

const ComparisonSchema = z.object({
  likelyMainOrdinal: z.number().int().positive().nullable(),
  likelySideOrdinals: z.array(z.number().int().positive()),
  confidence: z.enum(["low", "medium"]),
  reasonCodes: z.array(z.enum([
    "larger_subject",
    "less_blur",
    "less_crop",
    "less_obstruction",
    "better_composition",
    "unclear",
  ])),
}).strict();

export const ImageAnalysisTransportSchema: z.ZodType<ImageAnalysisResult> = z.object({
  schemaVersion: z.literal("1"),
  overallStatus: z.enum(["assessed", "unclear", "human_review_required"]),
  images: z.array(ImageRecordSchema).min(1).max(5),
  comparison: ComparisonSchema.nullable(),
  recommendationCodes: z.array(z.enum(RECOMMENDATION_CODES)),
  safeSummary: z.string().max(300),
}).strict();

const ISSUE_SUMMARIES: Readonly<Record<typeof ISSUE_CODES[number], (ordinal: number) => string>> = {
  request_original: (ordinal) => `Image ${ordinal} appears to be a screenshot; request the original file.`,
  request_uncropped: (ordinal) => `Image ${ordinal} appears cropped; request an uncropped version.`,
  request_closer_subject: (ordinal) => `The subject in Image ${ordinal} appears small; request a closer photo.`,
  request_less_obstructed: (ordinal) => `Image ${ordinal} appears obstructed; request a less obstructed photo.`,
  request_alternative: (ordinal) => `Image ${ordinal} has visible quality limitations; request an alternative.`,
  manual_assessment: (ordinal) => `Image ${ordinal} needs manual assessment.`,
};

function withinSummaryLimit(sentences: readonly string[]) {
  let summary = "";
  for (const sentence of sentences) {
    const next = summary ? `${summary} ${sentence}` : sentence;
    if (next.length > 300) break;
    summary = next;
  }
  return summary;
}

export function renderImageAnalysisSafeSummary(value: unknown): string {
  const result = ImageAnalysisTransportSchema.parse(value);
  const issueSentences = result.images.flatMap((image) => (
    image.issueCodes.map((code) => ISSUE_SUMMARIES[code](image.ordinal))
  ));
  if (issueSentences.length > 0) return withinSummaryLimit(issueSentences);

  const mainOrdinal = result.comparison?.likelyMainOrdinal
    ?? result.images.find((image) => image.recommendedRole === "main_candidate")?.ordinal;
  const sideOrdinals = result.images
    .filter((image) => image.recommendedRole === "side_candidate")
    .map((image) => image.ordinal);
  const recommendationSentences = result.recommendationCodes.flatMap((code) => {
    if (code === "send_original_file") return ["Request the original image file."];
    if (code === "send_uncropped_version") return ["Request an uncropped image version."];
    if (code === "send_closer_photo") return ["Request a closer photo of the subject."];
    if (code === "send_alternative_photo") return ["Request an alternative photo."];
    if (code === "use_as_main_candidate" && mainOrdinal) {
      return [`Image ${mainOrdinal} is the likely main candidate.`];
    }
    if (code === "use_as_side_candidate") {
      return sideOrdinals.map((ordinal) => `Image ${ordinal} is a likely side candidate.`);
    }
    if (code === "human_review") return ["The images need human assessment."];
    return [];
  });
  if (recommendationSentences.length > 0) return withinSummaryLimit(recommendationSentences);
  if (result.overallStatus === "human_review_required") return "The images need human assessment.";
  if (result.overallStatus === "unclear") return "The image assessment is unclear.";
  return "No image follow-up was identified.";
}

export const ImageAnalysisResultSchema: z.ZodType<ImageAnalysisResult> = ImageAnalysisTransportSchema
  .superRefine((result, context) => {
    if (result.safeSummary !== renderImageAnalysisSafeSummary(result)) {
      context.addIssue({
        code: "custom",
        path: ["safeSummary"],
        message: "Safe summary must be rendered from validated codes",
      });
    }
  });

export function parseImageAnalysisResult(
  value: unknown,
  submittedOrdinals?: readonly number[],
): ImageAnalysisResult {
  const result = ImageAnalysisResultSchema.parse(value);
  if (submittedOrdinals) {
    const expected = [...submittedOrdinals].sort((left, right) => left - right);
    const actual = result.images.map((image) => image.ordinal).sort((left, right) => left - right);
    const expectedSet = new Set(expected);
    const comparisonOrdinals = result.comparison
      ? [
        ...(result.comparison.likelyMainOrdinal === null ? [] : [result.comparison.likelyMainOrdinal]),
        ...result.comparison.likelySideOrdinals,
      ]
      : [];
    if (
      expected.length !== actual.length
      || expected.some((ordinal, index) => ordinal !== actual[index])
      || comparisonOrdinals.some((ordinal) => !expectedSet.has(ordinal))
    ) {
      throw new Error("image_analysis_ordinal_mismatch");
    }
  }
  return result;
}
