import { describe, expect, it, vi } from "vitest";
import { createMessagesHandler } from "./route-handler";

const forbiddenDtoPattern = new RegExp([
  ["source", "Url"].join(""),
  ["private", "Storage", "Key"].join(""),
  ["storage", "Key"].join(""),
  "sha256",
  ["external", "Attachment", "Key", "Hash"].join(""),
  ["sender", ".*", "hash"].join(""),
  ["conversation", ".*", "hash"].join(""),
  ["attachment", "Ids?"].join(""),
].join("|"), "i");

describe("reply assistant messages API", () => {
  it("requires permission and returns no-store safe DTOs", async () => {
    const requirePermission = vi.fn(async () => ({ user: { id: "staff-1" }, adminRole: "staff" as const }));
    const list = vi.fn(async () => ({ items: [{
      inboxId: "a".repeat(64),
      channel: "website" as const,
      latestMessageId: "11111111-1111-4111-8111-111111111111",
      lastActivityAt: "2026-08-17T00:00:01.000Z",
      unreadCount: 1,
      status: "received",
      latestAttemptId: null,
      draftText: null,
      gateResult: null,
      attachmentCount: 1,
      imageAnalysisStatus: "assessed" as const,
      imageAssessmentSummary: "Image 0 appears cropped; request an uncropped version.",
      humanReplyReceived: false,
      websiteReview: {
        selector: `wrs1.m8k6x0.${"A".repeat(43)}`,
        reason: "high_risk" as const,
        alertStatus: "sent" as const,
      },
      timeline: [{
        eventId: "assistant:22222222-2222-4222-8222-222222222222",
        role: "assistant" as const,
        text: "Please send the original photo.",
        receivedAt: "2026-08-17T00:00:01.000Z",
      }],
      hasEarlierTimeline: false,
    }] }));
    const response = await createMessagesHandler({ enabled: true, requirePermission, list }).GET();
    expect(requirePermission).toHaveBeenCalledWith("use_reply_assistant");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({ items: [{
      inboxId: "a".repeat(64),
      channel: "website",
      latestMessageId: "11111111-1111-4111-8111-111111111111",
      lastActivityAt: "2026-08-17T00:00:01.000Z",
      unreadCount: 1,
      status: "received",
      latestAttemptId: null,
      draftText: null,
      gateResult: null,
      attachmentCount: 1,
      imageAnalysisStatus: "assessed",
      imageAssessmentSummary: "Image 0 appears cropped; request an uncropped version.",
      humanReplyReceived: false,
      websiteReview: {
        selector: `wrs1.m8k6x0.${"A".repeat(43)}`,
        reason: "high_risk",
        alertStatus: "sent",
      },
      timeline: [{
        eventId: "assistant:22222222-2222-4222-8222-222222222222",
        role: "assistant",
        text: "Please send the original photo.",
        receivedAt: "2026-08-17T00:00:01.000Z",
      }],
      hasEarlierTimeline: false,
    }] });
    expect(JSON.stringify(body)).not.toMatch(forbiddenDtoPattern);
    expect(JSON.stringify(body)).not.toMatch(/deep.?link|token|conversationId|session|psid/i);
  });
});
