import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/server/auth/require-session";
import { InMemoryReplyRuntimeStore } from "@/server/rnr-ai/runtime-store/in-memory-reply-runtime-store";
import { createMetaReviewsHandler } from "./route-handler";

describe("Meta review metadata API", () => {
  it("lists only safe metadata after authorization", async () => {
    const now = new Date("2026-09-04T04:00:00.000Z");
    const store = new InMemoryReplyRuntimeStore({ now: () => now.getTime() });
    await store.putEncryptedReview("a".repeat(64), "ciphertext-not-plaintext", 172800, {
      conversationKeyHash: "b".repeat(64), risk: "YELLOW", createdAt: now.toISOString(),
    });
    const requirePermission = vi.fn(async () => ({ user: { id: "staff-1" } }));
    const response = await createMetaReviewsHandler({ store: () => store, requirePermission }).GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    expect(text).toContain("YELLOW");
    expect(text).not.toContain("ciphertext-not-plaintext");
    expect(text).not.toMatch(/psid|replyText|reasons/i);
  });

  it("does not touch the store before authorization", async () => {
    const listReviewMetadata = vi.fn();
    const response = await createMetaReviewsHandler({
      store: () => ({ listReviewMetadata } as never),
      requirePermission: vi.fn(async () => { throw new HttpError("FORBIDDEN", 403); }),
    }).GET();
    expect(response.status).toBe(403);
    expect(listReviewMetadata).not.toHaveBeenCalled();
  });
});
