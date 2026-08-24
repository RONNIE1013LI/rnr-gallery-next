import type {
  ChannelMetricCounts,
  PilotMetricCounts,
} from "./repositories/customer-service-repository";

function ratio(value: number, denominator: number) {
  return denominator > 0 ? value / denominator : 0;
}

export function calculateChannelMetrics(counts: ChannelMetricCounts) {
  return Object.freeze({
    ...counts,
    directAutomatedResolutionRate: ratio(
      counts.directTemplateReplies + counts.noReply,
      counts.meaningfulTurns,
    ),
    humanEscalationRate: ratio(counts.humanReviewsOpened, counts.meaningfulTurns),
    averageProviderLatencyMs: ratio(counts.totalLatencyMs, counts.providerCalls),
    averagePublicUpdateLatencyMs: ratio(
      counts.totalPublicUpdateLatencyMs,
      counts.publicUpdates,
    ),
  });
}

export function calculatePilotMetrics(counts: PilotMetricCounts) {
  return Object.freeze({
    ...counts,
    directAcceptanceRate: ratio(counts.acceptedUnchanged, counts.draftsGenerated),
    assistedAcceptanceRate: ratio(counts.acceptedUnchanged + counts.editedAccepted, counts.draftsGenerated),
    rejectionRate: ratio(counts.rejected, counts.draftsGenerated),
    gateBlockRate: ratio(counts.gateBlocked, counts.totalIncomingEligible),
    policyViolationRate: ratio(counts.policyViolationAttempts, counts.providerCalls),
    averageCostPerDraftMicrousd: ratio(counts.totalCostMicrousd, counts.draftsGenerated),
    averageLatencyMs: ratio(counts.totalLatencyMs, counts.providerCalls),
    averageImageCostPerCallMicrousd: ratio(counts.imageTotalCostMicrousd, counts.imageProviderCalls),
    averageImageLatencyMs: ratio(counts.imageTotalLatencyMs, counts.imageProviderCalls),
    combinedCostMicrousd: counts.totalCostMicrousd + counts.imageTotalCostMicrousd,
    imageAnalysisSuccessRate: ratio(counts.imageAnalysesSucceeded, counts.imageContexts),
    imageRequestOriginalRate: ratio(
      counts.imageRequestOriginalRecommendations,
      counts.imageAnalysesSucceeded,
    ),
    averageImageAwareCostPerDraftMicrousd: ratio(
      counts.imageAwareTotalCostMicrousd,
      counts.imageAwareDraftsGenerated,
    ),
    imageAwareDirectAcceptanceRate: ratio(
      counts.imageAwareAcceptedUnchanged,
      counts.imageAwareDraftsGenerated,
    ),
    imageAwareEditRate: ratio(counts.imageAwareEditedAccepted, counts.imageAwareDraftsGenerated),
    imageAwareRejectionRate: ratio(counts.imageAwareRejected, counts.imageAwareDraftsGenerated),
  });
}
