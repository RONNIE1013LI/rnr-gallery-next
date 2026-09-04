import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/server/auth/require-session";
import { InMemoryReplyRuntimeStore } from "@/server/rnr-ai/runtime-store/in-memory-reply-runtime-store";
import { createMetaReviewPayloadProtector } from "@/server/rnr-ai/meta/review-payload-protector";
import { createMetaReviewDetailHandler } from "./route-handler";

const key = "a".repeat(64);
const conversation = "b".repeat(64);
const now = new Date("2026-09-04T04:00:00.000Z");
const origin = "https://admin.test";
const reviewedTurnKeyHash = "c".repeat(64);

function releaseRequest(requestOrigin = origin, body: unknown = { action: "release_to_ai" }) {
  return new Request(`${origin}/api/reply-assistant/meta-reviews/${key}`, {
    method: "POST",
    headers: { origin: requestOrigin, "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function setup() {
  const store = new InMemoryReplyRuntimeStore({ now: () => now.getTime() });
  const protector = createMetaReviewPayloadProtector("review-secret-that-is-at-least-32-characters");
  await store.putEncryptedReview(key, protector.seal(key, {
    risk: "RED", replyText: "Private proposed reply", reasons: ["payment_request"],
  }), 172800, {
    conversationKeyHash: conversation,
    risk: "RED",
    createdAt: now.toISOString(),
    reviewedTurnKeyHash,
  });
  const requirePermission = vi.fn(async () => ({ user: { id: "staff-1" } }));
  return {
    store,
    protector,
    requirePermission,
    api: createMetaReviewDetailHandler({
      store: () => store,
      protector: () => protector,
      requirePermission,
      trustedOrigin: origin,
      now: () => now,
    }),
  };
}

describe("Meta review detail API", () => {
  it("decrypts only after authorization and returns no-store detail without ciphertext", async () => {
    const current = await setup();
    const response = await current.api.GET(new Request("https://admin.test/review"), { params: Promise.resolve({ reviewKey: key }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(current.requirePermission).toHaveBeenCalledWith("use_reply_assistant");
    const text = await response.text();
    expect(text).toContain("Private proposed reply");
    expect(text).toContain("payment_request");
    expect(text).toContain('"active":false');
    expect(text).not.toContain("v1.");
  });

  it("releases the reviewed Meta conversation to AI without requiring a Neon inbox row", async () => {
    const current = await setup();
    await current.store.setTakeover({
      conversationKeyHash: conversation,
      active: true,
      source: "risk",
      changedAt: new Date(now.getTime() - 1_000).toISOString(),
    });

    const response = await current.api.POST(releaseRequest(), { params: Promise.resolve({ reviewKey: key }) });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(current.requirePermission).toHaveBeenCalledWith("use_reply_assistant");
    await expect(response.json()).resolves.toEqual({
      takeover: { active: false, source: "admin", changedAt: now.toISOString() },
    });
    await expect(current.store.readTakeover(conversation)).resolves.toEqual({
      active: false,
      source: "admin",
      changedAt: now.toISOString(),
      resolvedTurnKeyHash: reviewedTurnKeyHash,
      resolvedThroughAt: now.toISOString(),
    });
  });

  it("keeps the internal reviewed-turn boundary out of the review detail response", async () => {
    const current = await setup();
    await current.store.setTakeover({
      conversationKeyHash: conversation,
      active: false,
      source: "admin",
      changedAt: now.toISOString(),
      resolvedTurnKeyHash: reviewedTurnKeyHash,
      resolvedThroughAt: now.toISOString(),
    });

    const response = await current.api.GET(new Request("https://admin.test/review"), { params: Promise.resolve({ reviewKey: key }) });
    const text = await response.text();
    expect(text).not.toContain("resolvedTurnKeyHash");
    expect(text).not.toContain(reviewedTurnKeyHash);
  });

  it("releases a legacy review using its creation time when no reviewed-turn hash exists", async () => {
    const current = await setup();
    await current.store.putEncryptedReview(key, current.protector.seal(key, {
      risk: "YELLOW", replyText: "Legacy private draft", reasons: ["legacy"],
    }), 172800, { conversationKeyHash: conversation, risk: "YELLOW", createdAt: now.toISOString() });

    const response = await current.api.POST(releaseRequest(), { params: Promise.resolve({ reviewKey: key }) });

    expect(response.status).toBe(200);
    await expect(current.store.readTakeover(conversation)).resolves.toEqual({
      active: false,
      source: "admin",
      changedAt: now.toISOString(),
      resolvedThroughAt: now.toISOString(),
    });
  });

  it("rejects activation, unknown actions and cross-origin release requests", async () => {
    const current = await setup();
    await current.store.setTakeover({
      conversationKeyHash: conversation,
      active: true,
      source: "risk",
      changedAt: now.toISOString(),
    });

    expect((await current.api.POST(releaseRequest(origin, { action: "take_over" }), { params: Promise.resolve({ reviewKey: key }) })).status).toBe(422);
    expect((await current.api.POST(releaseRequest("https://evil.test"), { params: Promise.resolve({ reviewKey: key }) })).status).toBe(403);
    await expect(current.store.readTakeover(conversation)).resolves.toMatchObject({ active: true, source: "risk" });
  });

  it("rejects invalid selectors and missing reviews", async () => {
    const current = await setup();
    expect((await current.api.GET(new Request("https://admin.test/review"), { params: Promise.resolve({ reviewKey: "raw-review-id" }) })).status).toBe(422);
    expect((await current.api.GET(new Request("https://admin.test/review"), { params: Promise.resolve({ reviewKey: "c".repeat(64) }) })).status).toBe(404);
  });

  it("never reads or decrypts before permission succeeds", async () => {
    const readEncryptedReview = vi.fn();
    const open = vi.fn();
    const denied = createMetaReviewDetailHandler({
      store: () => ({ readEncryptedReview } as never),
      protector: () => ({ open } as never),
      requirePermission: vi.fn(async () => { throw new HttpError("FORBIDDEN", 403); }),
      trustedOrigin: origin,
    });
    expect((await denied.GET(new Request("https://admin.test/review"), { params: Promise.resolve({ reviewKey: key }) })).status).toBe(403);
    expect((await denied.POST(releaseRequest(), { params: Promise.resolve({ reviewKey: key }) })).status).toBe(403);
    expect(readEncryptedReview).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
});
