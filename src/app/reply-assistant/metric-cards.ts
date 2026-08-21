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

export function replyAssistantMetricCards(counts: PilotMetricCounts): readonly ReplyAssistantMetricCard[] {
  const metrics = calculatePilotMetrics(counts);
  return [
    ["Incoming", metrics.totalIncomingEligible],
    ["Raw customer events", metrics.rawCustomerEvents],
    ["Meaningful turns", metrics.meaningfulTurns],
    ["Aggregated fragments", metrics.aggregatedFragments],
    ["Acknowledgements suppressed", metrics.acknowledgementsSuppressed],
    ["Drafts", metrics.draftsGenerated],
    ["Direct acceptance", percent(metrics.directAcceptanceRate)],
    ["Assisted acceptance", percent(metrics.assistedAcceptanceRate)],
    ["Rejected", percent(metrics.rejectionRate)],
    ["Gate blocked", metrics.gateBlocked],
    ["Validator blocked", metrics.outputValidatorBlocked],
    ["Policy violations", percent(metrics.policyViolationRate)],
    ["Avg latency", `${Math.round(metrics.averageLatencyMs)}ms`],
    ["Avg cost", `$${(metrics.averageCostPerDraftMicrousd / 1_000_000).toFixed(4)}`],
    ["Text spend", `$${(metrics.totalCostMicrousd / 1_000_000).toFixed(4)}`],
    ["Image calls", metrics.imageProviderCalls],
    ["Image input tokens", metrics.imageInputTokens],
    ["Image cached tokens", metrics.imageCachedInputTokens],
    ["Image output tokens", metrics.imageOutputTokens],
    ["Image spend", `$${(metrics.imageTotalCostMicrousd / 1_000_000).toFixed(4)}`],
    ["Image avg latency", `${Math.round(metrics.averageImageLatencyMs)}ms`],
    ["Image failures", metrics.imageFailures],
    ["Image cleanup deleted", metrics.imageCleanupDeleted],
    ["Image cleanup failed", metrics.imageCleanupFailures],
    ["Combined spend", `$${(metrics.combinedCostMicrousd / 1_000_000).toFixed(4)}`],
    ...pilotMetricCards(metrics),
    ...learningMetricCards(metrics),
  ];
}
import { calculateChannelMetrics, calculatePilotMetrics } from "@/server/customer-service/metrics";
import type {
  ChannelMetricCounts,
  PilotMetricCounts,
} from "@/server/customer-service/repositories/customer-service-repository";

export type ReplyAssistantMetricCard = readonly [string, string | number];

export function channelMetricCards(counts: ChannelMetricCounts): readonly ReplyAssistantMetricCard[] {
  const metrics = calculateChannelMetrics(counts);
  return [
    ["Sessions", metrics.sessions],
    ["Meaningful turns", metrics.meaningfulTurns],
    ["Responses", metrics.responses],
    ["Direct template replies", metrics.directTemplateReplies],
    ["No reply", metrics.noReply],
    ["Human reviews", metrics.humanReviewsOpened],
    ["Reviews resolved", metrics.humanReviewsResolved],
    ["Alerts queued", metrics.alertsQueued],
    ["Alerts sent", metrics.alertsSent],
    ["Alerts failed", metrics.alertsFailed],
    ["Website human replies", metrics.websiteHumanReplies],
    ["Rate blocks", metrics.rateBlocks],
    ["Budget blocks", metrics.budgetBlocks],
    ["Provider calls", metrics.providerCalls],
    ["Provider tokens", `${metrics.inputTokens} in / ${metrics.cachedInputTokens} cached / ${metrics.outputTokens} out`],
    ["Provider spend", `$${(metrics.totalCostMicrousd / 1_000_000).toFixed(4)}`],
    ["Provider latency", `${Math.round(metrics.averageProviderLatencyMs)}ms`],
    ["Direct resolution", percent(metrics.directAutomatedResolutionRate)],
    ["Human escalation", percent(metrics.humanEscalationRate)],
    ["Public update latency", `${Math.round(metrics.averagePublicUpdateLatencyMs)}ms`],
    ["Isolation violations", metrics.crossSessionIsolationViolations],
    ["Automatic business actions", metrics.automaticBusinessActions],
    ["Automatic sends", metrics.automaticSends],
  ];
}
