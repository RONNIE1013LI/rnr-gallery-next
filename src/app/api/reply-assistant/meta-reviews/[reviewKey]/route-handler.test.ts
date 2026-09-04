import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/server/auth/require-session";
import { InMemoryReplyRuntimeStore } from "@/server/rnr-ai/runtime-store/in-memory-reply-runtime-store";
import { createMetaReviewPayloadProtector } from "@/server/rnr-ai/meta/review-payload-protector";
import { createMetaReviewDetailHandler } from "./route-handler";

const key = "a".repeat(64);
const conversation = "b".repeat(64);
const now = new Date("2026-09-04T04:00:00.000Z");

async function setup() {
  const store = new InMemoryReplyRuntimeStore({ now: () => now.getTime() });
  const protector = createMetaReviewPayloadProtector("review-secret-that-is-at-least-32-characters");
  await store.putEncryptedReview(key, protector.seal(key, {
    risk: "RED", replyText: "Private proposed reply", reasons: ["payment_request"],
  }), 172800, { conversationKeyHash: conversation, risk: "RED", createdAt: now.toISOString() });
  const requirePermission = vi.fn(async () => ({ user: { id: "staff-1" } }));
  return { store, protector, requirePermission, api: createMetaReviewDetailHandler({ store: () => store, protector: () => protector, requirePermission }) };
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
    expect(text).not.toContain("v1.");
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
    });
    expect((await denied.GET(new Request("https://admin.test/review"), { params: Promise.resolve({ reviewKey: key }) })).status).toBe(403);
    expect(readEncryptedReview).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
});
