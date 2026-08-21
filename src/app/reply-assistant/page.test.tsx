import { createHash } from "node:crypto";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  resolveDeepLink: vi.fn(),
  renderDashboard: vi.fn(),
}));

const emptyCounts = {
  totalIncomingEligible: 0,
  rawCustomerEvents: 0,
  staffContextEvents: 0,
  meaningfulTurns: 0,
  aggregatedFragments: 0,
  acknowledgementsSuppressed: 0,
  draftsGenerated: 0,
  acceptedUnchanged: 0,
  editedAccepted: 0,
  rejected: 0,
  gateBlocked: 0,
  outputValidatorBlocked: 0,
  providerCalls: 0,
  policyViolationAttempts: 0,
  totalCostMicrousd: 0,
  totalLatencyMs: 0,
  imageProviderCalls: 0,
  imageInputTokens: 0,
  imageCachedInputTokens: 0,
  imageOutputTokens: 0,
  imageTotalCostMicrousd: 0,
  imageTotalLatencyMs: 0,
  imageFailures: 0,
  imageCleanupDeleted: 0,
  imageCleanupFailures: 0,
  imageContexts: 0,
  imageAnalysesSucceeded: 0,
  imageAnalysesBlocked: 0,
  imageAwareDraftsGenerated: 0,
  imageAwareAcceptedUnchanged: 0,
  imageAwareEditedAccepted: 0,
  imageAwareRejected: 0,
  imageRequestOriginalRecommendations: 0,
  imageAwareTotalCostMicrousd: 0,
  totalActualHumanReplies: 0,
  matchedHumanReplies: 0,
  unmatchedHumanReplies: 0,
  acceptedUnchangedHumanReplies: 0,
  editedHumanReplies: 0,
  independentlyWrittenHumanReplies: 0,
  reusableCaseMemories: 0,
  excludedHighRiskCases: 0,
  casesRetrievedInDrafts: 0,
  learningCandidatesPending: 0,
  learningCandidatesApproved: 0,
  learningCandidatesRejected: 0,
  commonEditReasons: [],
};

vi.mock("@/server/auth/require-admin", () => ({ requireAdminPermission: mocks.requirePermission }));
vi.mock("@/server/customer-service/config", () => ({
  parseCustomerServiceConfig: () => ({
    enabled: false,
    websiteEnabled: true,
    humanReplyGroupMs: 90_000,
  }),
}));
vi.mock("@/server/customer-service/runtime", () => ({
  createCustomerServiceRuntime: () => ({
    repository: {
      recoverDueHumanReplies: vi.fn(async () => ({ selected: 0, matched: 0, unmatched: 0 })),
      refreshLearningCandidates: vi.fn(async () => ({ checkpoint: 0, created: 0 })),
      getReplyAssistantUiCursor: vi.fn(async () => "cursor-1"),
      listQueue: vi.fn(async () => ({ items: [] })),
      metricCounts: vi.fn(async () => emptyCounts),
      listLearningCandidates: vi.fn(async () => ({ items: [] })),
      listCaseMemoryCandidates: vi.fn(async () => ({ items: [] })),
      resolveWebsiteReviewDeepLink: mocks.resolveDeepLink,
    },
  }),
}));
vi.mock("./metric-cards", () => ({ replyAssistantMetricCards: () => [] }));
vi.mock("./knowledge-provenance", () => ({ KnowledgeProvenance: () => null }));
vi.mock("./live-dashboard", () => ({
  ReplyAssistantLiveDashboard: (props: unknown) => {
    mocks.renderDashboard(props);
    return <div data-testid="reply-dashboard" />;
  },
}));

import ReplyAssistantPage from "./page";

describe("Reply Assistant website-review deep link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePermission.mockResolvedValue({
      user: { id: "staff-1" },
      adminRole: "staff",
      adminPermissions: ["use_reply_assistant"],
    });
  });

  it("authorizes first, hashes the token server-side, and passes only the matching review selector", async () => {
    const rawToken = "A".repeat(43);
    const reviewSelector = "33333333-3333-4333-8333-333333333333";
    mocks.resolveDeepLink.mockResolvedValue(reviewSelector);

    render(await ReplyAssistantPage({ searchParams: Promise.resolve({ review: rawToken }) }));

    expect(screen.getByTestId("reply-dashboard")).toBeInTheDocument();
    expect(mocks.requirePermission).toHaveBeenCalledWith("use_reply_assistant");
    expect(mocks.resolveDeepLink).toHaveBeenCalledWith({
      tokenHash: createHash("sha256").update(rawToken).digest("hex"),
      now: expect.any(Date),
    });
    const props = mocks.renderDashboard.mock.calls[0]?.[0];
    expect(props).toEqual(expect.objectContaining({ selectedReviewSelector: reviewSelector }));
    expect(JSON.stringify(props)).not.toContain(rawToken);
  });

  it("does not select an expired or tampered token", async () => {
    mocks.resolveDeepLink.mockResolvedValue(null);

    render(await ReplyAssistantPage({ searchParams: Promise.resolve({ review: "B".repeat(43) }) }));

    expect(mocks.renderDashboard).toHaveBeenCalledWith(expect.objectContaining({ selectedReviewSelector: null }));
  });

  it("does not look up a token when authorization fails", async () => {
    mocks.requirePermission.mockRejectedValue(new Error("redirect_or_forbidden"));

    await expect(ReplyAssistantPage({ searchParams: Promise.resolve({ review: "C".repeat(43) }) }))
      .rejects.toThrow("redirect_or_forbidden");
    expect(mocks.resolveDeepLink).not.toHaveBeenCalled();
  });
});
