import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AiControlConfig } from "../control/types";
import { InMemoryReplyRuntimeStore } from "./in-memory-reply-runtime-store";

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function control(revision: number, mode: AiControlConfig["mode"] = "OFF"): AiControlConfig {
  return {
    revision,
    mode,
    timezone: "Pacific/Auckland",
    periods: [],
    override: null,
  };
}

describe("ReplyRuntimeStore contract", () => {
  it("allows only one winner across twenty concurrent event claims", async () => {
    const store = new InMemoryReplyRuntimeStore();
    const claims = await Promise.all(Array.from({ length: 20 }, () => store.claimEvent(hash("event-1"), 30_000)));
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it("recovers a stale event lease and rejects the old lease token", async () => {
    let now = Date.parse("2026-09-04T00:00:00.000Z");
    const store = new InMemoryReplyRuntimeStore({ now: () => now });
    const first = await store.claimEvent(hash("event-2"), 1_000);
    now += 1_001;
    const second = await store.claimEvent(hash("event-2"), 1_000);
    expect(second?.leaseToken).not.toBe(first?.leaseToken);
    await expect(store.settleEvent(first!, { status: "processed", settledAt: new Date(now).toISOString() }))
      .rejects.toThrow(/lease/i);
  });

  it("uses revision CAS for control changes", async () => {
    const store = new InMemoryReplyRuntimeStore();
    expect(await store.compareAndSetControl(0, control(1, "ON"))).toBe(true);
    expect(await store.compareAndSetControl(0, control(1, "OFF"))).toBe(false);
    expect((await store.readControl()).config).toEqual(control(1, "ON"));
  });

  it("keeps takeover durable until an explicit mutation clears it", async () => {
    const store = new InMemoryReplyRuntimeStore();
    const key = hash("conversation-1");
    await store.setTakeover({ conversationKeyHash: key, active: true, source: "staff_echo", changedAt: "2026-09-04T00:00:00.000Z" });
    expect(await store.readTakeover(key)).toMatchObject({ active: true, source: "staff_echo" });
    expect(await store.readTakeover(key)).toMatchObject({ active: true });
    await store.setTakeover({ conversationKeyHash: key, active: false, source: "admin", changedAt: "2026-09-04T01:00:00.000Z" });
    expect(await store.readTakeover(key)).toMatchObject({ active: false, source: "admin" });
  });

  it("deduplicates backlog windows and prevents replay of terminal delivery", async () => {
    const store = new InMemoryReplyRuntimeStore();
    const window = { from: "2026-09-03T00:00:00.000Z", to: "2026-09-04T00:00:00.000Z", maxConversations: 100 as const };
    expect(await store.enqueueBacklog(2, window)).toBe(true);
    expect(await store.enqueueBacklog(2, window)).toBe(false);

    const key = hash("delivery-1");
    const lease = await store.claimDelivery(key, 30_000);
    expect(await store.readDelivery(key)).toEqual({ providerSendStartedAt: null, result: null });
    await store.beginDeliverySend(lease!, "2026-09-04T00:00:30.000Z");
    expect(await store.readDelivery(key)).toEqual({ providerSendStartedAt: "2026-09-04T00:00:30.000Z", result: null });
    const result = { status: "sent" as const, providerMessageIdMasked: "***1234", settledAt: "2026-09-04T00:01:00.000Z" };
    await store.settleDelivery(lease!, result);
    await expect(store.readDelivery(key)).resolves.toEqual({ providerSendStartedAt: "2026-09-04T00:00:30.000Z", result });
    expect(await store.claimDelivery(key, 30_000)).toBeNull();
    await expect(store.settleDelivery(lease!, { ...result, status: "delivery_uncertain" })).rejects.toThrow("lease");
  });

  it("never reclaims an expired delivery after provider send starts, but releases a definite non-send", async () => {
    let now = Date.parse("2026-09-04T00:00:00.000Z");
    const store = new InMemoryReplyRuntimeStore({ now: () => now });
    const uncertainKey = hash("delivery-uncertain");
    const uncertainLease = await store.claimDelivery(uncertainKey, 1_000);
    await store.beginDeliverySend(uncertainLease!, new Date(now).toISOString());
    now += 1_001;
    expect(await store.claimDelivery(uncertainKey, 1_000)).toBeNull();

    const retryKey = hash("delivery-definite-failure");
    const retryLease = await store.claimDelivery(retryKey, 1_000);
    await store.beginDeliverySend(retryLease!, new Date(now).toISOString());
    await store.releaseDelivery(retryLease!);
    expect(await store.claimDelivery(retryKey, 1_000)).not.toBeNull();
  });

  it("atomically claims one queued backlog and recovers a stale worker lease", async () => {
    let now = Date.parse("2026-09-04T00:00:00.000Z");
    const store = new InMemoryReplyRuntimeStore({ now: () => now });
    const window = { from: "2026-09-03T00:00:00.000Z", to: "2026-09-04T00:00:00.000Z", maxConversations: 100 as const };
    await store.enqueueBacklog(3, window);
    const claims = await Promise.all(Array.from({ length: 20 }, () => store.claimBacklog(1_000)));
    const first = claims.find(Boolean)!;
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(first).toMatchObject({ controlRevision: 3, window });
    now += 1_001;
    const recovered = await store.claimBacklog(1_000);
    expect(recovered?.leaseToken).not.toBe(first.leaseToken);
    await store.settleBacklog(recovered!, { status: "completed", settledAt: new Date(now).toISOString() });
    expect(await store.claimBacklog(1_000)).toBeNull();
  });

  it("expires encrypted reviews after exactly 48 hours under the injected clock", async () => {
    let now = Date.parse("2026-09-04T00:00:00.000Z");
    const store = new InMemoryReplyRuntimeStore({ now: () => now });
    const key = hash("review-1");
    await store.putEncryptedReview(key, "ciphertext-only", 172_800, {
      conversationKeyHash: hash("conversation-2"),
      risk: "YELLOW",
      createdAt: new Date(now).toISOString(),
    });
    now += 172_800_000 - 1;
    expect(await store.readEncryptedReview(key)).toBe("ciphertext-only");
    now += 1;
    expect(await store.readEncryptedReview(key)).toBeNull();
    expect(await store.listReviewMetadata(10)).toEqual([]);
  });

  it("expires encrypted attachment sources after at most 15 minutes", async () => {
    let now = Date.parse("2026-09-04T00:00:00.000Z");
    const store = new InMemoryReplyRuntimeStore({ now: () => now });
    const key = hash("ephemeral-source-1");
    await store.putEphemeralSecret(key, "v1.ciphertext-only", 900);
    now += 899_999;
    expect(await store.readEphemeralSecret(key)).toBe("v1.ciphertext-only");
    now += 1;
    expect(await store.readEphemeralSecret(key)).toBeNull();
    await expect(store.putEphemeralSecret(key, "v1.ciphertext-only", 901)).rejects.toThrow(/15 minutes/i);
  });

  it("retains only a hashed sender-echo marker and expires it", async () => {
    let now = Date.parse("2026-09-04T00:00:00.000Z");
    const store = new InMemoryReplyRuntimeStore({ now: () => now });
    const key = hash("provider-message-id");
    await store.rememberSenderEcho(key, 60);
    expect(await store.hasSenderEcho(key)).toBe(true);
    now += 60_000;
    expect(await store.hasSenderEcho(key)).toBe(false);
    expect(JSON.stringify(store.exportStateForTest())).not.toContain("provider-message-id");
  });

  it("stores only hashed identifiers and never serializes customer payload fields", async () => {
    const store = new InMemoryReplyRuntimeStore();
    await store.claimEvent(hash("psid-raw-value"), 1_000);
    await store.setTakeover({
      conversationKeyHash: hash("customer@example.com"),
      active: true,
      source: "risk",
      changedAt: "2026-09-04T00:00:00.000Z",
    });
    const serialized = JSON.stringify(store.exportStateForTest());
    expect(serialized).not.toMatch(/psid-raw-value|customer@example\.com|attachment|message|phone|email|https?:\/\//i);
    expect(serialized).toMatch(/[a-f0-9]{64}/);
  });
});
