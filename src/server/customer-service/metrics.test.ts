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
    })).toMatchObject({
      directAcceptanceRate: 0.4,
      assistedAcceptanceRate: 0.7,
      rejectionRate: 0.2,
      gateBlockRate: 0.25,
      policyViolationRate: 1 / 12,
      averageCostPerDraftMicrousd: 240,
      averageLatencyMs: 500,
    });
  });

  it("returns zero for zero denominators", () => {
    expect(calculatePilotMetrics({
      totalIncomingEligible: 0, draftsGenerated: 0, acceptedUnchanged: 0, editedAccepted: 0,
      rejected: 0, gateBlocked: 0, outputValidatorBlocked: 0, providerCalls: 0,
      policyViolationAttempts: 0, totalCostMicrousd: 0, totalLatencyMs: 0,
    })).toMatchObject({ directAcceptanceRate: 0, policyViolationRate: 0, averageLatencyMs: 0 });
  });
});
