import type { CustomerServiceIntent } from "./intent-detection";
import type { AnswerQualityGuide } from "./knowledge-retrieval";
import { validateDraft } from "./output-validator";

export type AnswerQualityGrade = Readonly<{
  factualCompleteness: number;
  productSpecificity: number | null;
  processCompleteness: number | null;
  requiredPointCoverage: number;
  missingRequiredPointIds: readonly string[];
  usefulNextStep: boolean;
  ronnieToneConsistency: boolean;
  unnecessaryVerbosity: boolean;
  unsupportedClaim: boolean;
  validatorCodes: readonly string[];
  rating: "DIRECTLY_USABLE" | "NEEDS_EDIT" | "REJECTED";
}>;

function ratio(matched: number, total: number) {
  return total ? matched / total : 1;
}

function rounded(value: number) {
  return Math.round(value * 1_000) / 1_000;
}

function groupCoverage(
  ids: readonly string[],
  matchedIds: ReadonlySet<string>,
  pattern: RegExp,
) {
  const applicable = ids.filter((id) => pattern.test(id));
  if (!applicable.length) return null;
  return rounded(ratio(applicable.filter((id) => matchedIds.has(id)).length, applicable.length));
}

export function gradeAnswerQuality({
  intent,
  draft,
  guide,
}: Readonly<{
  intent: CustomerServiceIntent;
  draft: string;
  guide: AnswerQualityGuide;
}>): AnswerQualityGrade {
  const value = String(draft ?? "").trim();
  const normalized = value.toLocaleLowerCase("en-NZ");
  const matchedIds = new Set(
    guide.requiredPoints
      .filter((point) => point.matchAny.some((term) => normalized.includes(term.toLocaleLowerCase("en-NZ"))))
      .map((point) => point.id),
  );
  const allPointIds = guide.requiredPoints.map((point) => point.id);
  const missingRequiredPointIds = allPointIds.filter((id) => !matchedIds.has(id));
  const requiredPointCoverage = rounded(ratio(matchedIds.size, allPointIds.length));
  const lines = value.split(/\r?\n/).filter((line) => line.trim());
  const unnecessaryVerbosity = lines.length > 5 || value.length > 800;
  const usefulNextStep = /\?|\b(?:please|may i|let us know|send through|send us|can you)\b/i.test(value);
  const validation = validateDraft(value, { intent });
  const ronnieToneConsistency = (
    !validation.codes.includes("ai_style")
    && (value.match(/!/g)?.length ?? 0) <= 2
    && !/valued customer|we appreciate your patience and understanding/i.test(value)
  );
  const unsupportedClaim = validation.codes.some((code) => !["tone_length", "ai_style"].includes(code));
  const rating = !validation.ok
    ? "REJECTED"
    : requiredPointCoverage >= 0.9 && usefulNextStep && ronnieToneConsistency && !unnecessaryVerbosity
      ? "DIRECTLY_USABLE"
      : "NEEDS_EDIT";

  return {
    factualCompleteness: requiredPointCoverage,
    productSpecificity: intent === "product_differences"
      ? groupCoverage(allPointIds, matchedIds, /product|display|recommendation/i)
      : null,
    processCompleteness: /^(?:design_process|production_process|payment_process)$/.test(intent)
      ? groupCoverage(allPointIds, matchedIds, /design|draft|review|adjust|approval|production|print|deposit|balance/i)
      : null,
    requiredPointCoverage,
    missingRequiredPointIds,
    usefulNextStep,
    ronnieToneConsistency,
    unnecessaryVerbosity,
    unsupportedClaim,
    validatorCodes: validation.codes,
    rating,
  };
}
