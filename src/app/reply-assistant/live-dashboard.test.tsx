import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mergeReplyQueueItems, ReplyAssistantLiveDashboard } from "./live-dashboard";
import type { PilotMetricCounts } from "@/server/customer-service/repositories/customer-service-repository";

const channelCounts = (sessions: number, directTemplateReplies: number) => ({
  sessions,
  meaningfulTurns: 5,
  responses: 4,
  directTemplateReplies,
  noReply: 1,
  humanReviewsOpened: 1,
  humanReviewsResolved: 0,
  alertsQueued: 1,
  alertsDeduplicated: 0,
  alertsSent: 1,
  alertsFailed: 0,
  websiteHumanReplies: 1,
  rateBlocks: 0,
  budgetBlocks: 0,
  providerCalls: 4,
  inputTokens: 100,
  cachedInputTokens: 10,
  outputTokens: 20,
  totalCostMicrousd: 100,
  totalLatencyMs: 400,
  publicUpdates: 4,
  totalPublicUpdateLatencyMs: 800,
  crossSessionIsolation: "test_only_invariant" as const,
  automaticBusinessActions: 0 as const,
  automaticSends: 0 as const,
});

const baseItem = {
  messageId: "11111111-1111-4111-8111-111111111111",
  channel: "facebook" as const,
  body: "Can you combine photos?",
  receivedAt: "2026-08-20T00:00:00.000Z",
  status: "processing",
  latestAttemptId: null,
  draftText: null,
  gateResult: null,
  attachmentCount: 0,
  imageAnalysisStatus: "not_applicable" as const,
  imageAssessmentSummary: null,
  humanReplyReceived: false,
  websiteReview: null,
  timeline: [{ role: "customer" as const, text: "Can you combine photos?", receivedAt: "2026-08-20T00:00:00.000Z" }],
};

const props = {
  initialCursor: "cursor-1",
  initialItems: [baseItem],
  initialMetricCards: [["Incoming", 1]] as const,
  initialLearningCandidates: [],
  initialCaseMemories: [],
  canReview: false,
};

const updatedMetrics: PilotMetricCounts = {
  totalIncomingEligible: 7,
  rawCustomerEvents: 7,
  staffContextEvents: 1,
  meaningfulTurns: 6,
  aggregatedFragments: 0,
  acknowledgementsSuppressed: 0,
  draftsGenerated: 2,
  acceptedUnchanged: 1,
  editedAccepted: 0,
  rejected: 0,
  gateBlocked: 1,
  outputValidatorBlocked: 0,
  providerCalls: 2,
  policyViolationAttempts: 0,
  totalCostMicrousd: 200,
  totalLatencyMs: 1_000,
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
  totalActualHumanReplies: 1,
  matchedHumanReplies: 1,
  unmatchedHumanReplies: 0,
  acceptedUnchangedHumanReplies: 0,
  editedHumanReplies: 1,
  independentlyWrittenHumanReplies: 0,
  reusableCaseMemories: 1,
  excludedHighRiskCases: 0,
  casesRetrievedInDrafts: 0,
  learningCandidatesPending: 1,
  learningCandidatesApproved: 0,
  learningCandidatesRejected: 0,
  commonEditReasons: [{ code: "missing_next_step", count: 1 }],
  channelMetrics: {
    website: channelCounts(4, 3),
    facebook: { ...channelCounts(9, 0), websiteHumanReplies: 0 },
  },
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

describe("ReplyAssistantLiveDashboard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps the selected deep-link review pinned while merging a full live queue", () => {
    const selector = `wrs1.m8k6x0.${"A".repeat(43)}`;
    const selected = {
      ...baseItem,
      messageId: "selected-review",
      channel: "website" as const,
      receivedAt: "2026-08-01T00:00:00.000Z",
      websiteReview: { selector, reason: "high_risk" as const, alertStatus: "pending" as const },
    };
    const newer = Array.from({ length: 100 }, (_, index) => ({
      ...baseItem,
      messageId: `newer-${index}`,
      receivedAt: new Date(Date.UTC(2026, 7, 2, 0, 0, index)).toISOString(),
    }));

    const merged = mergeReplyQueueItems([selected, ...newer], [], selector);

    expect(merged).toHaveLength(100);
    expect(merged[0]).toEqual(selected);
  });

  it("polls incremental updates and renders new messages, drafts, gate blocks, outbound replies, and learning changes", async () => {
    const newMessage = {
      ...baseItem,
      messageId: "22222222-2222-4222-8222-222222222222",
      body: "I want a refund",
      receivedAt: "2026-08-20T00:00:02.000Z",
      status: "blocked",
      gateResult: "high_risk",
    };
    const fetchMock = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
      void args;
      return response({
      cursor: "cursor-2",
      hasMore: false,
      queueItems: [
        { ...baseItem, status: "draft_ready", latestAttemptId: "33333333-3333-4333-8333-333333333333", draftText: "Yes, we can combine people from different photos." },
        newMessage,
      ],
      metrics: updatedMetrics,
      learningCandidates: { items: [{
        id: "44444444-4444-4444-8444-444444444444",
        intent: "photo_guidance",
        proposedChange: "Ask for the original photo.",
        reasonCodes: ["missing_next_step"],
        evidenceCount: 3,
        status: "pending",
      }] },
      caseMemories: { items: [{
        id: "55555555-5555-4555-8555-555555555555",
        intent: "photo_guidance",
        normalizedSituation: "Customer asks about combining photos.",
        humanFinalReply: "Please send the original photos.",
        status: "pending_review",
      }] },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ReplyAssistantLiveDashboard {...props} />);

    await advance(2_500);

    expect(screen.getByText("Yes, we can combine people from different photos.")).toBeInTheDocument();
    expect(screen.getByText("I want a refund")).toBeInTheDocument();
    expect(screen.getByText("Risk: high risk")).toBeInTheDocument();
    expect(screen.getByText("Ask for the original photo.")).toBeInTheDocument();
    expect(screen.getByText("Customer asks about combining photos.")).toBeInTheDocument();
    expect(screen.getByText("Incoming").parentElement).toHaveTextContent("7");
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/reply-assistant/updates?cursor=cursor-1",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(fetchMock.mock.calls.map(([url]) => String(url)).join("\n")).not.toMatch(/openai|generate|\/send/i);
  });

  it("filters metrics by channel without provider or polling work", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<ReplyAssistantLiveDashboard {...props} initialMetrics={updatedMetrics} />);

    fireEvent.click(screen.getByRole("button", { name: "Website metrics" }));
    expect(screen.getByText("Sessions").parentElement).toHaveTextContent("4");
    expect(screen.getByText("Direct template replies").parentElement).toHaveTextContent("3");

    fireEvent.click(screen.getByRole("button", { name: "Facebook metrics" }));
    expect(screen.getByText("Sessions").parentElement).toHaveTextContent("9");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps detailed metrics collapsed until staff asks to see them", () => {
    const metricCards = Array.from({ length: 10 }, (_, index) => [`Metric ${index + 1}`, index + 1] as const);
    vi.stubGlobal("fetch", vi.fn());

    render(<ReplyAssistantLiveDashboard {...props} initialMetricCards={metricCards} />);

    expect(screen.getByText("Metric 8")).toBeInTheDocument();
    expect(screen.queryByText("Metric 9")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show all 10 metrics" }));

    expect(screen.getByText("Metric 9")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show core metrics" })).toHaveAttribute("aria-expanded", "true");
  });

  it("renders repeated message and outbound echo updates only once", async () => {
    const outbound = {
      ...baseItem,
      humanReplyReceived: true,
      timeline: [
        ...baseItem.timeline,
        { role: "staff" as const, text: "Please send the original photos.", receivedAt: "2026-08-20T00:00:03.000Z" },
      ],
    };
    const update = {
      cursor: "cursor-2",
      hasMore: false,
      queueItems: [outbound, outbound],
      metrics: null,
      learningCandidates: null,
      caseMemories: null,
    };
    vi.stubGlobal("fetch", vi.fn(async () => response(update)));
    render(<ReplyAssistantLiveDashboard {...props} />);

    await advance(5_000);

    expect(screen.getAllByText("Please send the original photos.")).toHaveLength(1);
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText("Human reply sent in Meta. AI draft closed.")).toBeInTheDocument();
  });

  it("pauses while hidden and catches up immediately when the page becomes visible", async () => {
    const fetchMock = vi.fn(async () => response({
      cursor: "cursor-1",
      hasMore: false,
      queueItems: [],
      metrics: null,
      learningCandidates: null,
      caseMemories: null,
    }));
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    render(<ReplyAssistantLiveDashboard {...props} />);

    await advance(10_000);
    expect(fetchMock).not.toHaveBeenCalled();

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    fireEvent(document, new Event("visibilitychange"));
    await act(async () => { await Promise.resolve(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("recovers after a temporary network failure and uses the latest successful cursor", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(response({
        cursor: "cursor-2",
        hasMore: false,
        queueItems: [{ ...baseItem, status: "draft_ready", latestAttemptId: "55555555-5555-4555-8555-555555555555", draftText: "Recovered draft" }],
        metrics: null,
        learningCandidates: null,
        caseMemories: null,
      }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ReplyAssistantLiveDashboard {...props} />);

    await advance(2_500);
    expect(screen.getByText("Live updates reconnecting")).toBeInTheDocument();
    await advance(5_000);

    expect(screen.getByText("Recovered draft")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/reply-assistant/updates?cursor=cursor-1", expect.any(Object));
  });

  it("refreshes immediately on window focus and network recovery", async () => {
    const fetchMock = vi.fn(async () => response({
      cursor: "cursor-1",
      hasMore: false,
      queueItems: [],
      metrics: null,
      learningCandidates: null,
      caseMemories: null,
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ReplyAssistantLiveDashboard {...props} />);

    fireEvent.focus(window);
    await act(async () => { await Promise.resolve(); });
    fireEvent(window, new Event("online"));
    await act(async () => { await Promise.resolve(); });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
