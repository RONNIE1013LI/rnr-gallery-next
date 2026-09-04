import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAucklandOverrideExpiry,
  mergeReplyQueueItems,
  ReplyAssistantLiveDashboard,
} from "./live-dashboard";
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
  inboxId: "a".repeat(64),
  channel: "facebook" as const,
  latestMessageId: "11111111-1111-4111-8111-111111111111",
  lastActivityAt: "2026-08-20T00:00:00.000Z",
  unreadCount: 1,
  status: "processing",
  latestAttemptId: null,
  draftText: null,
  gateResult: null,
  attachmentCount: 0,
  imageAnalysisStatus: "not_applicable" as const,
  imageAssessmentSummary: null,
  humanReplyReceived: false,
  websiteReview: null,
  timeline: [{ eventId: "event:11111111-1111-4111-8111-111111111111", role: "customer" as const, text: "Can you combine photos?", receivedAt: "2026-08-20T00:00:00.000Z" }],
  hasEarlierTimeline: false,
};

const props = {
  initialCursor: "cursor-1",
  initialItems: [baseItem],
  initialMetricCards: [["Incoming", 1]] as const,
  initialLearningCandidates: [],
  initialCaseMemories: [],
  canReview: false,
  initialAiControl: {
    available: true,
    config: { revision: 3, mode: "SCHEDULE" as const, timezone: "Pacific/Auckland" as const, periods: [{ day: 1 as const, start: "09:00", end: "17:00" }], override: null },
    effective: { effectiveState: "OFF" as const, source: "schedule" as const, nextTransitionAt: "2026-09-07T21:00:00.000Z" },
  },
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

function emptyUpdate() {
  return {
    cursor: "cursor-1",
    hasMore: false,
    queueItems: [],
    metrics: null,
    learningCandidates: null,
    caseMemories: null,
  };
}

async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

describe("ReplyAssistantLiveDashboard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/reply-assistant");
    window.sessionStorage.clear();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
    window.sessionStorage.clear();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("labels the conversation queue as the primary needs-attention region", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<ReplyAssistantLiveDashboard {...props} />);

    expect(screen.getByRole("region", { name: "Needs attention conversations" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Needs attention" })).toBeInTheDocument();
    expect(screen.getByText("1 conversation")).toBeInTheDocument();
  });

  it("shows owner-facing schedule controls without polling", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<ReplyAssistantLiveDashboard {...props} />);

    const control = screen.getByRole("region", { name: "AI control" });
    expect(control).toHaveTextContent("AI operating mode");
    expect(control).toHaveTextContent("AI will be ON during the scheduled periods below.");
    expect(control).toHaveTextContent("Monday");
    expect(control).toHaveTextContent("Temporary override");
    expect(control).toHaveTextContent("Pacific/Auckland");
    expect(control).not.toHaveTextContent("Day 1");
    expect(control).not.toHaveTextContent("Force ON");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sorts schedule periods Monday through Sunday and describes full-day periods", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<ReplyAssistantLiveDashboard {...props} initialAiControl={{
      ...props.initialAiControl,
      config: {
        ...props.initialAiControl.config,
        periods: [
          { day: 0, start: "00:00", end: "23:59" },
          { day: 1, start: "09:00", end: "17:00" },
        ],
      },
    }} />);

    const schedule = screen.getByRole("list", { name: "Scheduled AI ON periods" });
    expect(schedule).toHaveTextContent("Monday");
    expect(schedule).toHaveTextContent("Sunday");
    expect(schedule).toHaveTextContent("All day");
    expect(schedule.textContent?.indexOf("Monday")).toBeLessThan(schedule.textContent?.indexOf("Sunday") ?? -1);
  });

  it("explains when the disabled master switch pauses scheduled transitions", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<ReplyAssistantLiveDashboard {...props} initialAiControl={{
      ...props.initialAiControl,
      effective: { effectiveState: "OFF", source: "master_kill", nextTransitionAt: null },
    }} />);

    const control = screen.getByRole("region", { name: "AI control" });
    expect(control).toHaveTextContent("AI is OFF");
    expect(control).toHaveTextContent("Master AI switch is disabled");
    expect(control).toHaveTextContent("Normal mode");
    expect(control).toHaveTextContent("Paused until Master AI is enabled");
  });

  it("converts only valid, unique Auckland local times within the 24-hour limit to ISO", () => {
    const now = new Date("2026-09-04T00:00:00.000Z");

    expect(buildAucklandOverrideExpiry("2026-09-05", "12:00", now)).toBe("2026-09-05T00:00:00.000Z");
    expect(buildAucklandOverrideExpiry("2026-09-05", "12:01", now)).toBeNull();
    expect(buildAucklandOverrideExpiry("2026-09-04", "11:59", now)).toBeNull();
    expect(buildAucklandOverrideExpiry("2026-02-30", "12:00", now)).toBeNull();
    expect(buildAucklandOverrideExpiry("2026-09-05", "24:00", now)).toBeNull();
    expect(buildAucklandOverrideExpiry("2026-9-05", "12:00", now)).toBeNull();
    expect(buildAucklandOverrideExpiry("2026-09-27", "02:30", new Date("2026-09-26T00:00:00.000Z"))).toBeNull();
    expect(buildAucklandOverrideExpiry("2026-04-05", "02:30", new Date("2026-04-04T00:00:00.000Z"))).toBeNull();
  });

  it("fails closed when the runtime control store is unavailable", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<ReplyAssistantLiveDashboard {...props} initialAiControl={{
      available: false,
      config: { revision: 0, mode: "OFF", timezone: "Pacific/Auckland", periods: [], override: null },
      effective: { effectiveState: "OFF", source: "invalid", nextTransitionAt: null },
    }} />);

    expect(screen.getByRole("region", { name: "AI control" })).toHaveTextContent("Runtime store unavailable — effective state is OFF");
  });

  it("requires confirmation before a temporary override POST and reports a revision conflict without retrying", async () => {
    vi.setSystemTime(new Date("2026-09-03T00:00:00.000Z"));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.override).toEqual({ state: "ON", expiresAt: "2026-09-04T00:00:00.000Z" });
      return response({ error: { code: "CONTROL_REVISION_CONFLICT" } }, 409);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ReplyAssistantLiveDashboard {...props} />);

    fireEvent.change(screen.getByLabelText("Override date"), { target: { value: "2026-09-04" } });
    fireEvent.change(screen.getByLabelText("Override time"), { target: { value: "12:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Turn AI ON temporarily" }));
    await act(async () => { await Promise.resolve(); });

    expect(confirm).toHaveBeenCalledWith("Turn AI ON temporarily until 4 Sept 2026, 12:00 pm?");
    expect(fetchMock).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Turn AI ON temporarily" }));
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByRole("alert")).toHaveTextContent("Control changed elsewhere. Refresh control before retrying.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows and cancels an existing temporary override only after an explicit action", async () => {
    vi.setSystemTime(new Date("2026-09-03T00:00:00.000Z"));
    const initialAiControl = {
      ...props.initialAiControl,
      config: {
        ...props.initialAiControl.config,
        override: { state: "ON" as const, expiresAt: "2026-09-04T00:00:00.000Z", actorUserId: "admin-1" },
      },
      effective: { effectiveState: "ON" as const, source: "override" as const, nextTransitionAt: "2026-09-04T00:00:00.000Z" },
    };
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.override).toBeNull();
      return response({
        config: { ...initialAiControl.config, revision: 4, override: null },
        effective: props.initialAiControl.effective,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ReplyAssistantLiveDashboard {...props} initialAiControl={initialAiControl} />);

    expect(screen.getByText(/Temporary override: AI ON\. Until:/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel override" }));
    await act(async () => { await Promise.resolve(); });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("loads review metadata and decrypts detail only after an explicit operator action", async () => {
    const reviewKey = "c".repeat(64);
    const conversationKey = "d".repeat(64);
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) === "/api/reply-assistant/meta-reviews") return response({ reviews: [{
        reviewKey, conversationKey, risk: "YELLOW", createdAt: "2026-09-04T01:00:00.000Z", expiresAt: "2026-09-06T01:00:00.000Z",
      }] });
      return response({ reviewKey, conversationKey, risk: "YELLOW", replyText: "Protected draft", reasons: ["review_required"], createdAt: "2026-09-04T01:00:00.000Z", expiresAt: "2026-09-06T01:00:00.000Z" });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ReplyAssistantLiveDashboard {...props} />);

    expect(screen.queryByText("Protected draft")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh Meta reviews" }));
    await act(async () => { await Promise.resolve(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Open protected review" }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("Protected draft")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).not.toContain(conversationKey);
  });

  it("keeps the selected deep-link review pinned while merging a full live queue", () => {
    const selector = `wrs1.m8k6x0.${"A".repeat(43)}`;
    const selected = {
      ...baseItem,
      inboxId: "selected-review",
      latestMessageId: "11111111-1111-4111-8111-111111111112",
      channel: "website" as const,
      lastActivityAt: "2026-08-01T00:00:00.000Z",
      websiteReview: { selector, reason: "high_risk" as const, alertStatus: "pending" as const },
    };
    const newer = Array.from({ length: 100 }, (_, index) => ({
      ...baseItem,
      inboxId: `newer-${index}`,
      latestMessageId: `newer-message-${index}`,
      lastActivityAt: new Date(Date.UTC(2026, 7, 2, 0, 0, index)).toISOString(),
    }));

    const merged = mergeReplyQueueItems([selected, ...newer], [], selector);

    expect(merged).toHaveLength(100);
    expect(merged[0]).toEqual(selected);
  });

  it("replaces one customer by inbox ID and moves the same box to the top", () => {
    const other = {
      ...baseItem,
      inboxId: "other-inbox",
      latestMessageId: "22222222-2222-4222-8222-222222222222",
      lastActivityAt: "2026-08-20T00:01:00.000Z",
    };
    const updated = {
      ...baseItem,
      latestMessageId: "33333333-3333-4333-8333-333333333333",
      lastActivityAt: "2026-08-20T00:02:00.000Z",
      timeline: [...baseItem.timeline, {
        eventId: "event:33333333-3333-4333-8333-333333333333",
        role: "customer" as const,
        text: "Now I need Canvas too",
        receivedAt: "2026-08-20T00:02:00.000Z",
      }],
    };

    const merged = mergeReplyQueueItems([baseItem, other], [updated, updated]);

    expect(merged).toHaveLength(2);
    expect(merged.map((entry) => entry.inboxId)).toEqual([baseItem.inboxId, other.inboxId]);
    expect(merged[0]?.latestMessageId).toBe(updated.latestMessageId);
  });

  it("manually refreshes incremental updates and renders new messages, drafts, gate blocks, outbound replies, and learning changes", async () => {
    const newMessage = {
      ...baseItem,
      inboxId: "b".repeat(64),
      latestMessageId: "22222222-2222-4222-8222-222222222222",
      lastActivityAt: "2026-08-20T00:00:02.000Z",
      status: "blocked",
      gateResult: "high_risk",
      timeline: [{ eventId: "event:22222222-2222-4222-8222-222222222222", role: "customer" as const, text: "I want a refund", receivedAt: "2026-08-20T00:00:02.000Z" }],
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
        observedPattern: "Human replies add the next supported photo step.",
        proposedChange: "Ask for the original photo.",
        reasonCodes: ["missing_next_step"],
        evidenceCount: 3,
        supportingCases: [{
          customer: "Customer asks for the next photo step.",
          aiDraft: "Yes, we can combine photos.",
          humanFinal: "Please send the original photos.",
          detectedChange: "Human reply added the next supported step.",
        }],
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

    await advance(15_000);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Refresh conversations" }));
    await act(async () => { await Promise.resolve(); });

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

  it("uses the selected channel for the metrics, count, and conversation list", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const facebookItems = Array.from({ length: 5 }, (_, index) => ({
      ...baseItem,
      inboxId: `facebook-inbox-${index}`,
      latestMessageId: `facebook-message-${index}`,
      timeline: [{ eventId: `event:facebook-${index}`, role: "customer" as const, text: `Facebook customer question ${index + 1}`, receivedAt: baseItem.lastActivityAt }],
    }));
    const websiteItems = Array.from({ length: 3 }, (_, index) => ({
      ...baseItem,
      inboxId: `website-inbox-${index}`,
      latestMessageId: `website-message-${index}`,
      channel: "website" as const,
      timeline: [{ eventId: `event:website-${index}`, role: "customer" as const, text: `Website customer question ${index + 1}`, receivedAt: baseItem.lastActivityAt }],
    }));
    render(<ReplyAssistantLiveDashboard
      {...props}
      initialItems={[...facebookItems, ...websiteItems]}
      initialMetrics={updatedMetrics}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Website metrics" }));
    expect(screen.getByText("3 conversations")).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.getAllByRole("article").every((article) => (
      within(article).getAllByText("Website").length >= 1
    ))).toBe(true);
    expect(screen.queryByText("Facebook customer question 1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Facebook metrics" }));
    expect(screen.getByText("5 conversations")).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(5);
    expect(screen.getAllByRole("article").every((article) => (
      within(article).getAllByText("Facebook").length >= 1
    ))).toBe(true);
    expect(screen.queryByText("Website customer question 1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "All metrics" }));
    expect(screen.getByText("8 conversations")).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(8);

    fireEvent.click(screen.getByRole("button", { name: "Website metrics" }));
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.queryByText("Facebook customer question 1")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps opposite-channel live updates out of the active filtered list", async () => {
    const incomingWebsite = {
      ...baseItem,
      inboxId: "incoming-website",
      latestMessageId: "incoming-website-message",
      channel: "website" as const,
      lastActivityAt: "2026-08-20T00:00:03.000Z",
      timeline: [{ eventId: "event:incoming-website", role: "customer" as const, text: "New website conversation", receivedAt: "2026-08-20T00:00:03.000Z" }],
    };
    const incomingFacebook = {
      ...baseItem,
      inboxId: "incoming-facebook",
      latestMessageId: "incoming-facebook-message",
      lastActivityAt: "2026-08-20T00:00:04.000Z",
      timeline: [{ eventId: "event:incoming-facebook", role: "customer" as const, text: "New Facebook conversation", receivedAt: "2026-08-20T00:00:04.000Z" }],
    };
    vi.stubGlobal("fetch", vi.fn(async () => response({
      ...emptyUpdate(),
      cursor: "cursor-2",
      queueItems: [incomingWebsite, incomingFacebook, incomingFacebook],
    })));
    render(<ReplyAssistantLiveDashboard {...props} initialMetrics={updatedMetrics} />);

    fireEvent.click(screen.getByRole("button", { name: "Website metrics" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh conversations" }));
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("New website conversation")).toBeInTheDocument();
    expect(screen.queryByText("New Facebook conversation")).not.toBeInTheDocument();
    expect(screen.getByText("1 conversation")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Facebook metrics" }));
    expect(screen.queryByText("New website conversation")).not.toBeInTheDocument();
    expect(screen.getByText("New Facebook conversation")).toBeInTheDocument();
    expect(screen.getByText("2 conversations")).toBeInTheDocument();
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
        { eventId: "event:staff-outbound", role: "staff" as const, text: "Please send the original photos.", receivedAt: "2026-08-20T00:00:03.000Z" },
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

    fireEvent.click(screen.getByRole("button", { name: "Refresh conversations" }));
    await act(async () => { await Promise.resolve(); });

    expect(screen.getAllByText("Please send the original photos.")).toHaveLength(1);
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText("Human reply sent in Meta. AI draft closed.")).toBeInTheDocument();
  });

  it("does not poll on timers, focus, visibility, or network lifecycle events", async () => {
    const fetchMock = vi.fn(async () => response(emptyUpdate()));
    vi.stubGlobal("fetch", fetchMock);
    render(<ReplyAssistantLiveDashboard {...props} />);

    await advance(15_000);
    fireEvent.focus(window);
    fireEvent(document, new Event("visibilitychange"));
    fireEvent(window, new Event("online"));
    fireEvent(window, new Event("offline"));
    await act(async () => { await Promise.resolve(); });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("performs one request per manual refresh and shows the update time", async () => {
    const fetchMock = vi.fn(async () => response(emptyUpdate()));
    vi.stubGlobal("fetch", fetchMock);
    render(<ReplyAssistantLiveDashboard {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Refresh conversations" }));
    await act(async () => { await Promise.resolve(); });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/^Last updated /)).toBeInTheDocument();
    await advance(15_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("aborts a pending manual refresh on unmount and never starts a timer request", async () => {
    let signal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      signal = init?.signal instanceof AbortSignal ? init.signal : undefined;
      return new Promise<Response>(() => {});
    });
    vi.stubGlobal("fetch", fetchMock);
    const dashboard = render(<ReplyAssistantLiveDashboard {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Refresh conversations" }));
    await act(async () => { await Promise.resolve(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(signal?.aborted).toBe(false);

    dashboard.unmount();

    expect(signal?.aborted).toBe(true);
    await advance(15_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a failed manual refresh without starting a retry loop", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("offline"));
    vi.stubGlobal("fetch", fetchMock);
    render(<ReplyAssistantLiveDashboard {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Refresh conversations" }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("Refresh failed")).toBeInTheDocument();

    await advance(15_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
