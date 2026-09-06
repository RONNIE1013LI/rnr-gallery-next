import { createHash } from "node:crypto";
import { Redis } from "@upstash/redis";
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

  it("recognizes the numeric sender-echo marker returned by Upstash auto-deserialization", async () => {
    const redis = redisMock();
    vi.mocked(redis.get).mockResolvedValue(1);
    const store = new RedisReplyRuntimeStore({ redis, namespace: "rnr-ai-test" });

    await expect(store.hasSenderEcho(hash("provider-message-id"))).resolves.toBe(true);
  });

  it("persists a hashed reviewed-turn boundary without raw conversation data", async () => {
    const redis = redisMock();
    const store = new RedisReplyRuntimeStore({ redis, namespace: "rnr-ai-test" });
    const conversationKeyHash = hash("raw-conversation-id");
    const resolvedTurnKeyHash = hash("raw-reviewed-turn-id");

    await store.setTakeover({
      conversationKeyHash,
      active: false,
      source: "admin",
      changedAt: "2026-09-04T01:00:00.000Z",
      resolvedTurnKeyHash,
      resolvedThroughAt: "2026-09-04T00:59:00.000Z",
    });

    expect(redis.set).toHaveBeenCalledWith(
      `rnr-ai-test:takeover:${conversationKeyHash}`,
      expect.objectContaining({ active: false, resolvedTurnKeyHash, resolvedThroughAt: "2026-09-04T00:59:00.000Z" }),
    );
    expect(JSON.stringify(vi.mocked(redis.set).mock.calls)).not.toMatch(/raw-conversation-id|raw-reviewed-turn-id/);
  });
});

describe.runIf(Boolean(process.env.WEBSITE_TEST_REDIS_URL))("real Redis channel control isolation", () => {
  it("preserves the legacy schedule once, then isolates concurrent channel updates", async () => {
    const redis = new Redis({ url: process.env.WEBSITE_TEST_REDIS_URL!, token: "synthetic-local-redis-test" });
    const namespace = "channel-test-" + crypto.randomUUID();
    const store = new RedisReplyRuntimeStore({ redis, namespace });
    const legacy = { revision: 8, mode: "SCHEDULE" as const, timezone: "Pacific/Auckland" as const, periods: [{ day: 1 as const, start: "09:00", end: "17:00" }], override: null };
    try {
      await redis.set(namespace + ":control", legacy);
      expect(await store.compareAndSetControl(8, { ...legacy, revision: 9, mode: "OFF" }, "meta")).toBe(true);
      expect((await store.readControl("website")).config).toEqual(legacy);
      const results = await Promise.all([
        store.compareAndSetControl(8, { ...legacy, revision: 9, mode: "ON" }, "website"),
        store.compareAndSetControl(9, { ...legacy, revision: 10, mode: "ON" }, "meta"),
      ]);
      expect(results).toEqual([true, true]);
      expect(await store.compareAndSetControl(8, { ...legacy, revision: 9, mode: "OFF" }, "website")).toBe(false);
      expect((await store.readControl("website")).config).toMatchObject({ revision: 9, mode: "ON" });
      expect((await store.readControl("meta")).config).toMatchObject({ revision: 10, mode: "ON" });
      expect(await store.compareAndSetControl(9, { ...legacy, revision: 10, mode: "OFF" }, "website")).toBe(true);
      expect((await store.readControl("meta")).config.mode).toBe("ON");
    } finally { await redis.del(namespace + ":control", namespace + ":control:website"); }
  });
});
