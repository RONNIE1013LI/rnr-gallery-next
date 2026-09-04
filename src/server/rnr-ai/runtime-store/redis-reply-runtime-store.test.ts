import { createHash } from "node:crypto";
import type { Redis } from "@upstash/redis";
import { describe, expect, it, vi } from "vitest";
import { RedisReplyRuntimeStore } from "./redis-reply-runtime-store";

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function redisMock() {
  return {
    eval: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
    zrange: vi.fn(),
    zrem: vi.fn(),
    del: vi.fn(),
  } as unknown as Redis;
}

describe("RedisReplyRuntimeStore", () => {
  it("fails closed when any dedicated Redis credential is missing", () => {
    expect(() => RedisReplyRuntimeStore.fromEnvironment({})).toThrow(/configuration is unavailable/i);
    expect(() => RedisReplyRuntimeStore.fromEnvironment({
      RNR_AI_REDIS_REST_URL: "https://example.invalid",
      RNR_AI_REDIS_REST_TOKEN: "token",
    })).toThrow(/configuration is unavailable/i);
  });

  it("uses one atomic Lua evaluation for an event claim", async () => {
    const redis = redisMock();
    vi.mocked(redis.eval).mockResolvedValue("lease-token");
    const store = new RedisReplyRuntimeStore({
      redis,
      namespace: "rnr-ai-test",
      now: () => Date.parse("2026-09-04T00:00:00.000Z"),
    });

    await expect(store.claimEvent(hash("event"), 30_000)).resolves.toMatchObject({
      leaseToken: "lease-token",
      expiresAt: "2026-09-04T00:00:30.000Z",
    });
    expect(redis.eval).toHaveBeenCalledTimes(1);
  });

  it("propagates store failure and never falls back to process memory", async () => {
    const redis = redisMock();
    vi.mocked(redis.eval).mockRejectedValue(new Error("redis unavailable"));
    const store = new RedisReplyRuntimeStore({ redis, namespace: "rnr-ai-test" });

    await expect(store.claimDelivery(hash("delivery"), 30_000)).rejects.toThrow("redis unavailable");
  });
});
