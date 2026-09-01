import { describe, expect, it, vi } from "vitest";
import {
  createReplyAssistantUpdateReader,
  decodeReplyAssistantCursor,
  encodeReplyAssistantCursor,
} from "./live-updates";

const queueItem = (inboxId: string, latestMessageId: string, lastActivityAt: string) => ({
  inboxId,
  channel: "facebook" as const,
  latestMessageId,
  lastActivityAt,
  unreadCount: 1,
  status: "received",
  latestAttemptId: null,
  draftText: null,
  gateResult: null,
  attachmentCount: 0,
  imageAnalysisStatus: "not_applicable" as const,
  imageAssessmentSummary: null,
  humanReplyReceived: false,
  websiteReview: null,
  timeline: [],
  hasEarlierTimeline: false,
});

describe("reply assistant live update reader", () => {
  it("round-trips an opaque revision cursor and rejects malformed input", () => {
    const cursor = encodeReplyAssistantCursor(42);
    expect(cursor).not.toContain("42");
    expect(decodeReplyAssistantCursor(cursor)).toBe(42);
    expect(() => decodeReplyAssistantCursor("not-a-cursor")).toThrow("invalid_reply_assistant_cursor");
  });

  it("returns an empty delta without loading dashboard data when the revision is unchanged", async () => {
    const dependencies = {
      readChanges: vi.fn(async () => ({ currentRevision: 8, changes: [], hasMore: false })),
      loadQueueByMessageIds: vi.fn(),
      loadQueueByConversationIds: vi.fn(),
      loadMetrics: vi.fn(),
      loadLearningCandidates: vi.fn(),
      loadCaseMemories: vi.fn(),
    };
    const reader = createReplyAssistantUpdateReader(dependencies);

    const result = await reader(encodeReplyAssistantCursor(8), 250);

    expect(result).toEqual({
      cursor: encodeReplyAssistantCursor(8),
      hasMore: false,
      queueItems: [],
      metrics: null,
      learningCandidates: null,
      caseMemories: null,
    });
    expect(dependencies.loadQueueByMessageIds).not.toHaveBeenCalled();
    expect(dependencies.loadMetrics).not.toHaveBeenCalled();
  });

  it("loads only changed scopes and de-duplicates queue items", async () => {
    const fromMessage = queueItem("inbox-1", "message-1", "2026-08-20T00:00:00.000Z");
    const fromConversation = [
      queueItem("inbox-1", "message-1", "2026-08-20T00:00:00.000Z"),
      queueItem("inbox-2", "message-2", "2026-08-20T00:00:01.000Z"),
    ];
    const reader = createReplyAssistantUpdateReader({
      readChanges: vi.fn(async () => ({
        currentRevision: 15,
        hasMore: false,
        changes: [
          { scope: "queue_message" as const, entityKey: "message-1", revision: 11 },
          { scope: "queue_conversation" as const, entityKey: "conversation-1", revision: 12 },
          { scope: "metrics" as const, entityKey: "all", revision: 13 },
          { scope: "learning_candidates" as const, entityKey: "candidate-1", revision: 14 },
          { scope: "case_memories" as const, entityKey: "case-1", revision: 15 },
        ],
      })),
      loadQueueByMessageIds: vi.fn(async () => [fromMessage]),
      loadQueueByConversationIds: vi.fn(async () => fromConversation),
      loadMetrics: vi.fn(async () => ({ draftsGenerated: 2 } as never)),
      loadLearningCandidates: vi.fn(async () => ({ items: [{ id: "candidate-1" }] } as never)),
      loadCaseMemories: vi.fn(async () => ({ items: [{ id: "case-1" }] } as never)),
    });

    const result = await reader(encodeReplyAssistantCursor(10), 250);

    expect(result.cursor).toBe(encodeReplyAssistantCursor(15));
    expect(result.queueItems.map((item) => item.inboxId)).toEqual(["inbox-2", "inbox-1"]);
    expect(result.metrics).toEqual({ draftsGenerated: 2 });
    expect(result.learningCandidates).toEqual({ items: [{ id: "candidate-1" }] });
    expect(result.caseMemories).toEqual({ items: [{ id: "case-1" }] });
  });

  it("returns one changed Inbox item when two technical conversations resolve to the same identity", async () => {
    const reader = createReplyAssistantUpdateReader({
      readChanges: vi.fn(async () => ({
        currentRevision: 32,
        hasMore: false,
        changes: [
          { scope: "queue_conversation" as const, entityKey: "conversation-1", revision: 31 },
          { scope: "queue_conversation" as const, entityKey: "conversation-2", revision: 32 },
        ],
      })),
      loadQueueByMessageIds: vi.fn(),
      loadQueueByConversationIds: vi.fn(async () => [
        queueItem("shared-inbox", "message-old", "2026-08-20T00:00:00.000Z"),
        queueItem("shared-inbox", "message-new", "2026-08-20T00:00:02.000Z"),
      ]),
      loadMetrics: vi.fn(),
      loadLearningCandidates: vi.fn(),
      loadCaseMemories: vi.fn(),
    });

    const result = await reader(encodeReplyAssistantCursor(30), 250);

    expect(result.queueItems).toHaveLength(1);
    expect(result.queueItems[0]).toMatchObject({
      inboxId: "shared-inbox",
      latestMessageId: "message-new",
      lastActivityAt: "2026-08-20T00:00:02.000Z",
    });
  });

  it("advances only to the last returned revision when more changes remain", async () => {
    const reader = createReplyAssistantUpdateReader({
      readChanges: vi.fn(async () => ({
        currentRevision: 99,
        hasMore: true,
        changes: [{ scope: "metrics" as const, entityKey: "all", revision: 21 }],
      })),
      loadQueueByMessageIds: vi.fn(),
      loadQueueByConversationIds: vi.fn(),
      loadMetrics: vi.fn(async () => ({ draftsGenerated: 1 } as never)),
      loadLearningCandidates: vi.fn(),
      loadCaseMemories: vi.fn(),
    });

    const result = await reader(encodeReplyAssistantCursor(20), 1);

    expect(result.hasMore).toBe(true);
    expect(result.cursor).toBe(encodeReplyAssistantCursor(21));
  });

  it("does not move behind a change committed after the revision watermark was read", async () => {
    const reader = createReplyAssistantUpdateReader({
      readChanges: vi.fn(async () => ({
        currentRevision: 20,
        hasMore: false,
        changes: [{ scope: "metrics" as const, entityKey: "all", revision: 21 }],
      })),
      loadQueueByMessageIds: vi.fn(),
      loadQueueByConversationIds: vi.fn(),
      loadMetrics: vi.fn(async () => ({ draftsGenerated: 1 } as never)),
      loadLearningCandidates: vi.fn(),
      loadCaseMemories: vi.fn(),
    });

    const result = await reader(encodeReplyAssistantCursor(19), 10);

    expect(result.cursor).toBe(encodeReplyAssistantCursor(21));
  });
});
