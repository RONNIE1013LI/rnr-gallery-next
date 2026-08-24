import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/server/auth/require-session";
import { createReplyAssistantUpdatesHandler } from "./route-handler";

const updatePage = {
  cursor: "eyJ2IjoxLCJyIjoyfQ",
  hasMore: false,
  queueItems: [{
    messageId: "11111111-1111-4111-8111-111111111111",
    channel: "facebook" as const,
    body: "Hello",
    receivedAt: "2026-08-20T00:00:00.000Z",
    status: "draft_ready",
    latestAttemptId: "22222222-2222-4222-8222-222222222222",
    draftText: "Hi, how can we help?",
    gateResult: "allowed",
    attachmentCount: 0,
    imageAnalysisStatus: "not_applicable" as const,
    imageAssessmentSummary: null,
    humanReplyReceived: false,
    websiteReview: null,
    timeline: [{ role: "customer" as const, text: "Hello", receivedAt: "2026-08-20T00:00:00.000Z" }],
  }],
  metrics: null,
  learningCandidates: null,
  caseMemories: null,
};

describe("reply assistant incremental updates API", () => {
  it("requires use_reply_assistant permission before reading updates", async () => {
    const requirePermission = vi.fn(async () => ({ user: { id: "staff-1" }, adminRole: "staff" as const }));
    const listUpdates = vi.fn(async () => updatePage);
    const handler = createReplyAssistantUpdatesHandler({ enabled: true, requirePermission, listUpdates });

    const response = await handler.GET(new Request("https://admin.test/api/reply-assistant/updates?cursor=eyJ2IjoxLCJyIjoxfQ"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(requirePermission).toHaveBeenCalledWith("use_reply_assistant");
    expect(listUpdates).toHaveBeenCalledWith("eyJ2IjoxLCJyIjoxfQ");
    await expect(response.json()).resolves.toEqual(updatePage);
  });

  it.each([
    [401, "UNAUTHORIZED"],
    [403, "FORBIDDEN"],
  ])("returns %i without querying data when permission is denied", async (status, code) => {
    const listUpdates = vi.fn(async () => updatePage);
    const handler = createReplyAssistantUpdatesHandler({
      enabled: true,
      requirePermission: vi.fn(async () => { throw new HttpError(code, status); }),
      listUpdates,
    });

    const response = await handler.GET(new Request("https://admin.test/api/reply-assistant/updates"));

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: { code } });
    expect(listUpdates).not.toHaveBeenCalled();
  });

  it("rejects an oversized cursor before querying the repository", async () => {
    const listUpdates = vi.fn(async () => updatePage);
    const handler = createReplyAssistantUpdatesHandler({
      enabled: true,
      requirePermission: vi.fn(async () => ({ user: { id: "admin-1" }, adminRole: "admin" as const })),
      listUpdates,
    });

    const response = await handler.GET(new Request(`https://admin.test/api/reply-assistant/updates?cursor=${"x".repeat(513)}`));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { code: "INVALID_CURSOR" } });
    expect(listUpdates).not.toHaveBeenCalled();
  });

  it("returns a safe 400 response for a malformed cursor", async () => {
    const handler = createReplyAssistantUpdatesHandler({
      enabled: true,
      requirePermission: vi.fn(async () => ({ user: { id: "admin-1" }, adminRole: "admin" as const })),
      listUpdates: vi.fn(async () => { throw new Error("invalid_reply_assistant_cursor"); }),
    });

    const response = await handler.GET(new Request("https://admin.test/api/reply-assistant/updates?cursor=bad"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { code: "INVALID_CURSOR" } });
  });
});
