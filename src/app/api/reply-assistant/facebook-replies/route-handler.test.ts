import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/server/auth/require-session";
import { createFacebookReplyHandler } from "./route-handler";

const origin = "https://admin.test";
const input = Object.freeze({
  inboxId: "a".repeat(64),
  attemptId: "11111111-1111-4111-8111-111111111111",
  text: "  Final edited reply  ",
  idempotencyKey: "manual-send-1",
});
const item = Object.freeze({
  inboxId: input.inboxId, channel: "facebook" as const, latestMessageId: "22222222-2222-4222-8222-222222222222",
  lastActivityAt: "2026-09-04T04:00:00.000Z", unreadCount: 0, status: "draft_ready",
  latestAttemptId: input.attemptId, draftText: null, gateResult: null, attachmentCount: 0,
  imageAnalysisStatus: "not_applicable" as const, imageAssessmentSummary: null, humanReplyReceived: true,
  websiteReview: null, timeline: [], hasEarlierTimeline: false,
});

function request(body: unknown, requestOrigin = origin) {
  return new Request(`${origin}/api/reply-assistant/facebook-replies`, {
    method: "POST",
    headers: { origin: requestOrigin, "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("manual Facebook reply API", () => {
  it("requires staff permission and forwards only the safe server selector plus trimmed current text", async () => {
    const send = vi.fn(async () => ({ status: "sent" as const, duplicate: false, item }));
    const handler = createFacebookReplyHandler({
      enabled: true,
      trustedOrigin: origin,
      requirePermission: vi.fn(async () => ({ user: { id: "staff-1" } })),
      send,
    });
    const response = await handler.POST(request(input));
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(send).toHaveBeenCalledWith({ ...input, text: "Final edited reply", actorUserId: "staff-1" });
    await expect(response.json()).resolves.toMatchObject({ status: "sent", item, takeover: { active: true, source: "admin" } });
  });

  it.each(["recipientId", "psid", "pageId", "accessToken", "targetUrl"])("rejects arbitrary browser-supplied %s", async (field) => {
    const send = vi.fn();
    const handler = createFacebookReplyHandler({
      enabled: true,
      trustedOrigin: origin,
      requirePermission: vi.fn(async () => ({ user: { id: "staff-1" } })),
      send,
    });
    const response = await handler.POST(request({ ...input, [field]: "attacker-choice" }));
    expect(response.status).toBe(422);
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated, cross-origin, empty and overlong sends before the provider", async () => {
    const send = vi.fn();
    const base = { enabled: true, trustedOrigin: origin, send };
    const denied = createFacebookReplyHandler({
      ...base,
      requirePermission: vi.fn(async () => { throw new HttpError("UNAUTHORIZED", 401); }),
    });
    expect((await denied.POST(request(input))).status).toBe(401);
    const allowed = createFacebookReplyHandler({
      ...base,
      requirePermission: vi.fn(async () => ({ user: { id: "staff-1" } })),
    });
    expect((await allowed.POST(request(input, "https://evil.test"))).status).toBe(403);
    expect((await allowed.POST(request({ ...input, text: " " }))).status).toBe(422);
    expect((await allowed.POST(request({ ...input, text: "x".repeat(2_001) }))).status).toBe(422);
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ["failed", 502, "META_SEND_FAILED"],
    ["delivery_uncertain", 409, "DELIVERY_UNCERTAIN"],
    ["unavailable", 409, "FACEBOOK_REPLY_UNAVAILABLE"],
  ] as const)("maps %s without claiming a send", async (status, expectedStatus, code) => {
    const handler = createFacebookReplyHandler({
      enabled: true,
      trustedOrigin: origin,
      requirePermission: vi.fn(async () => ({ user: { id: "staff-1" } })),
      send: vi.fn(async () => ({ status })),
    });
    const response = await handler.POST(request(input));
    expect(response.status).toBe(expectedStatus);
    await expect(response.json()).resolves.toEqual({ error: { code } });
  });
});
