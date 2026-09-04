import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/server/auth/require-session";
import { InMemoryReplyRuntimeStore } from "@/server/rnr-ai/runtime-store/in-memory-reply-runtime-store";
import { createAiControlHandler } from "./route-handler";

const origin = "https://admin.test";
const now = new Date("2026-09-04T00:00:00.000Z");

function mutation(body: unknown, requestOrigin = origin) {
  return new Request(`${origin}/api/reply-assistant/control`, {
    method: "POST",
    headers: { origin: requestOrigin, "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function handler(store = new InMemoryReplyRuntimeStore({ now: () => now.getTime() })) {
  const requirePermission = vi.fn(async () => ({ user: { id: "admin-1" } }));
  return {
    store,
    requirePermission,
    api: createAiControlHandler({
      store: () => store,
      requirePermission,
      trustedOrigin: origin,
      masterEnabled: true,
      now: () => now,
    }),
  };
}

describe("AI control API", () => {
  it("protects GET and returns no-store control plus effective state", async () => {
    const current = handler();
    const response = await current.api.GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(current.requirePermission).toHaveBeenCalledWith("use_reply_assistant");
    await expect(response.json()).resolves.toMatchObject({ config: { mode: "OFF" }, effective: { effectiveState: "OFF" } });
  });

  it("rejects unauthorised and cross-origin mutations before changing control", async () => {
    const unauthorised = handler();
    const deny = createAiControlHandler({
      store: () => unauthorised.store,
      requirePermission: vi.fn(async () => { throw new HttpError("FORBIDDEN", 403); }),
      trustedOrigin: origin,
      masterEnabled: true,
      now: () => now,
    });
    expect((await deny.POST(mutation({ revision: 0, mode: "ON", periods: [], override: null }))).status).toBe(403);
    expect((await unauthorised.api.POST(mutation({ revision: 0, mode: "ON", periods: [], override: null }, "https://evil.test"))).status).toBe(403);
    expect((await unauthorised.store.readControl()).config.mode).toBe("OFF");
  });

  it("commits OFF to ON with CAS and enqueues one bounded 24-hour backlog", async () => {
    const current = handler();
    const response = await current.api.POST(mutation({ revision: 0, mode: "ON", periods: [], override: null }));
    expect(response.status).toBe(200);
    expect((await current.store.readControl()).config).toMatchObject({ revision: 1, mode: "ON" });
    expect(await current.store.enqueueBacklog(1, {
      from: "2026-09-03T00:00:00.000Z",
      to: "2026-09-04T00:00:00.000Z",
      maxConversations: 100,
    })).toBe(false);
  });

  it("makes an identical retry idempotent", async () => {
    const current = handler();
    const body = { revision: 0, mode: "ON", periods: [], override: null };
    expect((await current.api.POST(mutation(body))).status).toBe(200);
    expect((await current.api.POST(mutation(body))).status).toBe(200);
    expect((await current.store.readControl()).config.revision).toBe(1);
  });

  it("requires override expiry and caps manual override at 24 hours", async () => {
    const current = handler();
    for (const override of [
      { state: "ON" },
      { state: "ON", expiresAt: "2026-09-05T00:00:00.001Z" },
    ]) {
      const response = await current.api.POST(mutation({ revision: 0, mode: "OFF", periods: [], override }));
      expect(response.status).toBe(422);
    }
  });

  it("returns conflict for a stale non-identical revision", async () => {
    const current = handler();
    await current.api.POST(mutation({ revision: 0, mode: "ON", periods: [], override: null }));
    const response = await current.api.POST(mutation({ revision: 0, mode: "SCHEDULE", periods: [], override: null }));
    expect(response.status).toBe(409);
  });
});
