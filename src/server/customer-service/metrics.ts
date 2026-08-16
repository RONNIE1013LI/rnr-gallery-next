import type { PilotMetricCounts } from "./repositories/customer-service-repository";

function ratio(value: number, denominator: number) {
  return denominator > 0 ? value / denominator : 0;
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
  });
}
