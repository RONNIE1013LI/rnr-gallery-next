import { describe, expect, it } from "vitest";
import { pilotMetricCards } from "./metric-cards";

describe("reply assistant image metric cards", () => {
  it("shows the required image context, outcome, cost, and feedback measures", () => {
    const cards = pilotMetricCards({
      imageContexts: 8,
      imageAnalysesSucceeded: 6,
      imageAnalysesBlocked: 2,
      imageAnalysisSuccessRate: 0.75,
      imageRequestOriginalRate: 0.5,
      averageImageAwareCostPerDraftMicrousd: 250,
      imageAwareDirectAcceptanceRate: 0.5,
      imageAwareEditRate: 0.25,
      imageAwareRejectionRate: 0.125,
    });
    expect(Object.fromEntries(cards)).toEqual({
      "Image contexts": 8,
      "Image analyses passed": 6,
      "Image analyses blocked": 2,
      "Image analysis success": "75%",
      "Request original": "50%",
      "Image-aware avg cost": "$0.0003",
      "Image-aware direct": "50%",
      "Image-aware edited": "25%",
      "Image-aware rejected": "13%",
    });
  });
});
