import { describe, expect, it } from "vitest";
import { calculatePilotMetrics } from "./metrics";

describe("reply assistant pilot metrics", () => {
  it("uses explicit stable denominators", () => {
    expect(calculatePilotMetrics({
      totalIncomingEligible: 20,
      draftsGenerated: 10,
      acceptedUnchanged: 4,
      editedAccepted: 3,
      rejected: 2,
      gateBlocked: 5,
      outputValidatorBlocked: 1,
      providerCalls: 12,
      policyViolationAttempts: 1,
      totalCostMicrousd: 2_400,
      totalLatencyMs: 6_000,
      imageProviderCalls: 3,
      imageInputTokens: 90,
      imageCachedInputTokens: 15,
      imageOutputTokens: 30,
      imageTotalCostMicrousd: 600,
      imageTotalLatencyMs: 1_200,
      imageFailures: 1,
      imageCleanupDeleted: 2,
      imageCleanupFailures: 1,
    })).toMatchObject({
      directAcceptanceRate: 0.4,
      assistedAcceptanceRate: 0.7,
      rejectionRate: 0.2,
      gateBlockRate: 0.25,
      policyViolationRate: 1 / 12,
      averageCostPerDraftMicrousd: 240,
      averageLatencyMs: 500,
      averageImageCostPerCallMicrousd: 200,
      averageImageLatencyMs: 400,
      combinedCostMicrousd: 3_000,
    });
  });

  it("returns zero for zero denominators", () => {
    expect(calculatePilotMetrics({
      totalIncomingEligible: 0, draftsGenerated: 0, acceptedUnchanged: 0, editedAccepted: 0,
      rejected: 0, gateBlocked: 0, outputValidatorBlocked: 0, providerCalls: 0,
      policyViolationAttempts: 0, totalCostMicrousd: 0, totalLatencyMs: 0,
      imageProviderCalls: 0, imageInputTokens: 0, imageCachedInputTokens: 0,
      imageOutputTokens: 0, imageTotalCostMicrousd: 0, imageTotalLatencyMs: 0,
      imageFailures: 0, imageCleanupDeleted: 0, imageCleanupFailures: 0,
    })).toMatchObject({
      directAcceptanceRate: 0,
      policyViolationRate: 0,
      averageLatencyMs: 0,
      averageImageCostPerCallMicrousd: 0,
      averageImageLatencyMs: 0,
      combinedCostMicrousd: 0,
    });
  });
});
