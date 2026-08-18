type ImageMetrics = Readonly<{
  imageContexts: number;
  imageAnalysesSucceeded: number;
  imageAnalysesBlocked: number;
  imageAnalysisSuccessRate: number;
  imageRequestOriginalRate: number;
  averageImageAwareCostPerDraftMicrousd: number;
  imageAwareDirectAcceptanceRate: number;
  imageAwareEditRate: number;
  imageAwareRejectionRate: number;
}>;

const percent = (value: number) => `${Math.round(value * 100)}%`;

export function pilotMetricCards(metrics: ImageMetrics) {
  return [
    ["Image contexts", metrics.imageContexts],
    ["Image analyses passed", metrics.imageAnalysesSucceeded],
    ["Image analyses blocked", metrics.imageAnalysesBlocked],
    ["Image analysis success", percent(metrics.imageAnalysisSuccessRate)],
    ["Request original", percent(metrics.imageRequestOriginalRate)],
    ["Image-aware avg cost", `$${(metrics.averageImageAwareCostPerDraftMicrousd / 1_000_000).toFixed(4)}`],
    ["Image-aware direct", percent(metrics.imageAwareDirectAcceptanceRate)],
    ["Image-aware edited", percent(metrics.imageAwareEditRate)],
    ["Image-aware rejected", percent(metrics.imageAwareRejectionRate)],
  ] as const;
}

type LearningMetrics = Readonly<{
  totalActualHumanReplies: number;
  matchedHumanReplies: number;
  unmatchedHumanReplies: number;
  acceptedUnchangedHumanReplies: number;
  editedHumanReplies: number;
  independentlyWrittenHumanReplies: number;
  reusableCaseMemories: number;
  excludedHighRiskCases: number;
  casesRetrievedInDrafts: number;
  learningCandidatesPending: number;
  learningCandidatesApproved: number;
  learningCandidatesRejected: number;
  commonEditReasons: readonly Readonly<{ code: string; count: number }>[];
}>;

export function learningMetricCards(metrics: LearningMetrics) {
  return [
    ["Human replies", metrics.totalActualHumanReplies],
    ["Matched replies", metrics.matchedHumanReplies],
    ["Unmatched replies", metrics.unmatchedHumanReplies],
    ["Accepted unchanged", metrics.acceptedUnchangedHumanReplies],
    ["Edited replies", metrics.editedHumanReplies],
    ["AI ignored / independent", metrics.independentlyWrittenHumanReplies],
    ["Reusable cases", metrics.reusableCaseMemories],
    ["Excluded high risk", metrics.excludedHighRiskCases],
    ["Cases used in drafts", metrics.casesRetrievedInDrafts],
    ["Learning pending", metrics.learningCandidatesPending],
    ["Learning approved", metrics.learningCandidatesApproved],
    ["Learning rejected", metrics.learningCandidatesRejected],
    ["Common edits", metrics.commonEditReasons.length
      ? metrics.commonEditReasons.map((reason) => `${reasonLabel(reason.code)} (${reason.count})`).join(", ")
      : "None"],
  ] as const;
}

function reasonLabel(code: string) {
  return code.replaceAll("_", " ");
}
