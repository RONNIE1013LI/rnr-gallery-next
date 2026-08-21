import { describe, expect, it } from "vitest";
import { channelMetricCards } from "./metric-cards";

describe("Reply Assistant channel metric cards", () => {
  it("shows Website operations and keeps zero-action invariants visible", () => {
    const cards = channelMetricCards({
      sessions: 4,
      meaningfulTurns: 10,
      responses: 8,
      directTemplateReplies: 6,
      noReply: 1,
      humanReviewsOpened: 3,
      humanReviewsResolved: 2,
      alertsQueued: 3,
      alertsSent: 2,
      alertsFailed: 1,
      websiteHumanReplies: 2,
      rateBlocks: 4,
      budgetBlocks: 1,
      providerCalls: 7,
      inputTokens: 700,
      cachedInputTokens: 70,
      outputTokens: 140,
      totalCostMicrousd: 3_500,
      totalLatencyMs: 2_100,
      publicUpdates: 8,
      totalPublicUpdateLatencyMs: 4_000,
      crossSessionIsolationViolations: 0,
      automaticBusinessActions: 0,
      automaticSends: 0,
    });

    expect(cards).toEqual(expect.arrayContaining([
      ["Sessions", 4],
      ["Direct template replies", 6],
      ["No reply", 1],
      ["Human reviews", 3],
      ["Provider tokens", "700 in / 70 cached / 140 out"],
      ["Automatic business actions", 0],
      ["Automatic sends", 0],
    ]));
  });
});
