import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/server/auth/require-session";
import { createReplyAssistantTimelineHandler } from "./route-handler";

const inboxId = "a".repeat(64);
const cursor = "event:11111111-1111-4111-8111-111111111111";
const page = {
  events: [{
    eventId: "event:22222222-2222-4222-8222-222222222222",
    role: "customer" as const,
    text: "Earlier customer question",
    receivedAt: "2026-08-17T00:00:00.000Z",
  }],
  cursor: null,
  hasEarlier: false,
};
const context = { params: Promise.resolve({ inboxId }) };

describe("reply assistant Inbox timeline API", () => {
  it("requires Admin permission and returns only the safe identity-scoped page", async () => {
    const requirePermission = vi.fn(async () => ({ user: { id: "staff-1" }, adminRole: "staff" as const }));
    const loadTimeline = vi.fn(async () => page);
    const handler = createReplyAssistantTimelineHandler({ enabled: true, requirePermission, loadTimeline });

    const response = await handler.GET(
      new Request(`https://admin.test/api/reply-assistant/inbox/${inboxId}/timeline?cursor=${encodeURIComponent(cursor)}`),
      context,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(requirePermission).toHaveBeenCalledWith("use_reply_assistant");
    expect(loadTimeline).toHaveBeenCalledWith({ inboxId, cursor, limit: 50 });
    await expect(response.json()).resolves.toEqual(page);
    expect(JSON.stringify(page)).not.toMatch(/identityKind|identityKey|conversationId|sessionId|psid|visitor/i);
  });

  it.each([
    ["not-a-hash", cursor],
    [inboxId, "event:not-a-uuid"],
    [inboxId, `event:${"x".repeat(513)}`],
  ])("rejects invalid opaque scope or cursor before repository access", async (requestedInboxId, requestedCursor) => {
    const loadTimeline = vi.fn(async () => page);
    const handler = createReplyAssistantTimelineHandler({
      enabled: true,
      requirePermission: vi.fn(async () => ({ user: { id: "admin-1" }, adminRole: "admin" as const })),
      loadTimeline,
    });

    const response = await handler.GET(
      new Request(`https://admin.test/api/reply-assistant/inbox/${requestedInboxId}/timeline?cursor=${encodeURIComponent(requestedCursor)}`),
      { params: Promise.resolve({ inboxId: requestedInboxId }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { code: "INVALID_TIMELINE_CURSOR" } });
    expect(loadTimeline).not.toHaveBeenCalled();
  });

  it("does not query timeline data when permission is denied", async () => {
    const loadTimeline = vi.fn(async () => page);
    const handler = createReplyAssistantTimelineHandler({
      enabled: true,
      requirePermission: vi.fn(async () => { throw new HttpError("FORBIDDEN", 403); }),
      loadTimeline,
    });

    const response = await handler.GET(
      new Request(`https://admin.test/api/reply-assistant/inbox/${inboxId}/timeline?cursor=${encodeURIComponent(cursor)}`),
      context,
    );

    expect(response.status).toBe(403);
    expect(loadTimeline).not.toHaveBeenCalled();
  });

  it("fails closed when a cursor is not owned by the requested Inbox", async () => {
    const handler = createReplyAssistantTimelineHandler({
      enabled: true,
      requirePermission: vi.fn(async () => ({ user: { id: "admin-1" }, adminRole: "admin" as const })),
      loadTimeline: vi.fn(async () => { throw new Error("reply_assistant_timeline_cursor_invalid"); }),
    });

    const response = await handler.GET(
      new Request(`https://admin.test/api/reply-assistant/inbox/${inboxId}/timeline?cursor=${encodeURIComponent(cursor)}`),
      context,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { code: "INVALID_TIMELINE_CURSOR" } });
  });
});
