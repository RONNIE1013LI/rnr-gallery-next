import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/server/auth/require-session";
import { createWebsiteReplyHandler } from "./route-handler";

const trustedOrigin = "https://admin.test";
const reviewSelector = `wrs1.m8k6x0.${"A".repeat(43)}`;

function request(body: unknown) {
  return new Request(`${trustedOrigin}/api/reply-assistant/website-replies`, {
    method: "POST",
    headers: {
      origin: trustedOrigin,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("manual website reply API", () => {
  it("requires use_reply_assistant and persists only trimmed text plus a queue review selector", async () => {
    const requirePermission = vi.fn(async () => ({ user: { id: "staff-1" }, adminRole: "staff" as const }));
    const answer = vi.fn(async () => ({ status: "sent" as const }));
    const handler = createWebsiteReplyHandler({
      enabled: true,
      trustedOrigin,
      requirePermission,
      answer,
      now: () => new Date("2026-08-22T00:00:00.000Z"),
    });

    const response = await handler.POST(request({ reviewSelector, text: "  We have reviewed this for you.  " }));

    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(requirePermission).toHaveBeenCalledWith("use_reply_assistant");
    expect(answer).toHaveBeenCalledWith({
      reviewSelector,
      text: "We have reviewed this for you.",
      actorUserId: "staff-1",
      now: new Date("2026-08-22T00:00:00.000Z"),
    });
    await expect(response.json()).resolves.toEqual({ sent: true });
  });

  it.each([
    [401, "UNAUTHORIZED"],
    [403, "FORBIDDEN"],
  ])("returns %i before resolving a selector when permission is denied", async (status, code) => {
    const answer = vi.fn(async () => ({ status: "sent" as const }));
    const handler = createWebsiteReplyHandler({
      enabled: true,
      trustedOrigin,
      requirePermission: vi.fn(async () => { throw new HttpError(code, status); }),
      answer,
    });

    const response = await handler.POST(request({ reviewSelector, text: "Staff reply" }));

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: { code } });
    expect(answer).not.toHaveBeenCalled();
  });

  it.each([
    "forged",
    "unknown",
    "resolved",
    "cross_channel",
  ])("rejects a %s selector with the same generic response", async () => {
    const answer = vi.fn(async () => ({ status: "unavailable" as const }));
    const handler = createWebsiteReplyHandler({
      enabled: true,
      trustedOrigin,
      requirePermission: vi.fn(async () => ({ user: { id: "staff-1" }, adminRole: "staff" as const })),
      answer,
    });

    const response = await handler.POST(request({ reviewSelector, text: "Staff reply" }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: { code: "REVIEW_UNAVAILABLE" } });
  });

  it("rejects arbitrary conversation, session, message, and PSID selectors", async () => {
    const answer = vi.fn(async () => ({ status: "sent" as const }));
    const handler = createWebsiteReplyHandler({
      enabled: true,
      trustedOrigin,
      requirePermission: vi.fn(async () => ({ user: { id: "staff-1" }, adminRole: "staff" as const })),
      answer,
    });

    for (const forbidden of ["conversationId", "sessionId", "messageId", "psid"]) {
      const response = await handler.POST(request({ reviewSelector, text: "Staff reply", [forbidden]: "attacker-choice" }));
      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toEqual({ error: { code: "VALIDATION_ERROR" } });
    }
    expect(answer).not.toHaveBeenCalled();
  });

  it.each([
    ["", 422],
    ["\u0000hidden", 422],
    ["x".repeat(2_001), 422],
  ])("rejects unsafe reply text", async (text, status) => {
    const answer = vi.fn(async () => ({ status: "sent" as const }));
    const handler = createWebsiteReplyHandler({
      enabled: true,
      trustedOrigin,
      requirePermission: vi.fn(async () => ({ user: { id: "staff-1" }, adminRole: "staff" as const })),
      answer,
    });

    const response = await handler.POST(request({ reviewSelector, text }));

    expect(response.status).toBe(status);
    expect(answer).not.toHaveBeenCalled();
  });

  it("returns the same success for an idempotent network retry without provider or Messenger dependencies", async () => {
    const answer = vi.fn(async () => ({ status: "duplicate" as const }));
    const handler = createWebsiteReplyHandler({
      enabled: true,
      trustedOrigin,
      requirePermission: vi.fn(async () => ({ user: { id: "staff-1" }, adminRole: "staff" as const })),
      answer,
    });

    const response = await handler.POST(request({ reviewSelector, text: "Staff reply" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ sent: true });
    expect(Object.keys(handler)).toEqual(["POST"]);
  });
});
