import { describe, expect, it } from "vitest";
import { learningMetricCards, pilotMetricCards } from "./metric-cards";

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

  it("shows every continuous-learning measure without exposing identifiers", () => {
    expect(Object.fromEntries(learningMetricCards({
      totalActualHumanReplies: 12,
      matchedHumanReplies: 8,
      unmatchedHumanReplies: 4,
      acceptedUnchangedHumanReplies: 3,
      editedHumanReplies: 4,
      independentlyWrittenHumanReplies: 1,
      reusableCaseMemories: 5,
      excludedHighRiskCases: 2,
      casesRetrievedInDrafts: 7,
      learningCandidatesPending: 4,
      learningCandidatesApproved: 2,
      learningCandidatesRejected: 1,
      commonEditReasons: [{ code: "missing_next_step", count: 4 }],
    }))).toEqual({
      "Human replies": 12,
      "Matched replies": 8,
      "Unmatched replies": 4,
      "Accepted unchanged": 3,
      "Edited replies": 4,
      "AI ignored / independent": 1,
      "Reusable cases": 5,
      "Excluded high risk": 2,
      "Cases used in drafts": 7,
      "Learning pending": 4,
      "Learning approved": 2,
      "Learning rejected": 1,
      "Common edits": "missing next step (4)",
    });
  });
});
