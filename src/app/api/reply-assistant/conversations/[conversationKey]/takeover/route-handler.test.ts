import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/server/auth/require-session";
import { InMemoryReplyRuntimeStore } from "@/server/rnr-ai/runtime-store/in-memory-reply-runtime-store";
import { createConversationTakeoverHandler } from "./route-handler";

const origin = "https://admin.test";
const selector = "a".repeat(64);
const identityKeyHash = "b".repeat(64);
const now = new Date("2026-09-04T03:00:00.000Z");

function request(body: unknown, requestOrigin = origin) {
  return new Request(`${origin}/api/reply-assistant/conversations/${selector}/takeover`, {
    method: "POST",
    headers: { origin: requestOrigin, "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function setup() {
  const store = new InMemoryReplyRuntimeStore({ now: () => now.getTime() });
  const requirePermission = vi.fn(async () => ({ user: { id: "admin-1" } }));
  return {
    store,
    requirePermission,
    api: createConversationTakeoverHandler({
      store: () => store,
      resolveInbox: vi.fn(async () => ({ identityKeyHash })),
      requirePermission,
      trustedOrigin: origin,
      now: () => now,
    }),
  };
}

describe("conversation takeover API", () => {
  it("authorizes and returns only safe takeover state", async () => {
    const current = setup();
    const response = await current.api.GET(new Request(`${origin}/takeover`), { params: Promise.resolve({ conversationKey: selector }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(current.requirePermission).toHaveBeenCalledWith("use_reply_assistant");
    expect(await current.store.readTakeover(selector)).toBeNull();
    await expect(response.json()).resolves.toEqual({ active: false, source: null, changedAt: null });
  });

  it("activates and explicitly releases sticky admin takeover", async () => {
    const current = setup();
    for (const active of [true, false]) {
      const response = await current.api.POST(request({ active }), { params: Promise.resolve({ conversationKey: selector }) });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ active, source: "admin", changedAt: now.toISOString() });
    }
    expect(await current.store.readTakeover(identityKeyHash)).toMatchObject({ active: false, source: "admin" });
  });

  it("rejects raw identifiers, unauthorized users and cross-origin mutations", async () => {
    const current = setup();
    expect((await current.api.POST(request({ active: true }), { params: Promise.resolve({ conversationKey: "raw-psid-123" }) })).status).toBe(422);
    expect((await current.api.POST(request({ active: true }, "https://evil.test"), { params: Promise.resolve({ conversationKey: selector }) })).status).toBe(403);
    const denied = createConversationTakeoverHandler({
      store: () => current.store,
      resolveInbox: vi.fn(async () => ({ identityKeyHash })),
      requirePermission: vi.fn(async () => { throw new HttpError("FORBIDDEN", 403); }),
      trustedOrigin: origin,
    });
    expect((await denied.GET(new Request(`${origin}/takeover`), { params: Promise.resolve({ conversationKey: selector }) })).status).toBe(403);
  });
});
