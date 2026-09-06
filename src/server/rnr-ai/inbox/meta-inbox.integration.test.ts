import { randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";
import { describe, expect, it, vi } from "vitest";
import { MetaInbox } from "./meta-inbox";

// Synthetic, loopback-only Redis. Never inherit any Production credential.
const url = process.env.RNR_INBOX_TEST_REDIS_URL;
describe.skipIf(!url)("Meta inbox real Redis", () => {
  it("keeps locators encrypted and shares discovery/cache between instances", async () => {
    if (!url || new URL(url).hostname !== "127.0.0.1") throw new Error("local_test_redis_required");
    const redis = new Redis({ url, token: "synthetic-local-redis-test", responseEncoding: false });
    const namespace = `test:inbox:${randomUUID()}`;
    const loadConversation = vi.fn(async () => ({ channel: "facebook" as const, events: [], complete: true, incompleteReason: null, characters: 0, turnsConsidered: 0 }));
    const discover = vi.fn(async () => [{ channel: "facebook" as const, externalConversationKey: "synthetic-customer", pageId: "synthetic-page", updatedAt: new Date().toISOString() }]);
    const dependencies = { redis, namespace, encryptionKey: "synthetic-key-".repeat(4), idHashSecret: "synthetic-hash", pageId: "synthetic-page", context: { loadConversation }, discover };
    try {
      const first = await new MetaInbox(dependencies).list();
      const second = await new MetaInbox(dependencies).list();
      expect(first.items).toHaveLength(1);
      expect(second).toEqual(first);
      expect(discover).toHaveBeenCalledTimes(1);
      expect(loadConversation).toHaveBeenCalledTimes(2);
      const inbox = new MetaInbox(dependencies);
      const newer = new Date();
      await inbox.index("synthetic-customer", newer);
      await inbox.index("synthetic-customer", new Date(newer.getTime() - 1000));
      expect((await inbox.resolve(first.items[0].inboxId))?.locator.updatedAt).toBe(newer.toISOString());
      const keys = await redis.keys(`${namespace}:*`);
      const locatorKey = keys.find(key => /meta:[a-f0-9]{64}$/.test(key));
      expect(locatorKey).toBeTruthy();
      expect(await redis.get(locatorKey!)).not.toContain("synthetic-customer");
    } finally {
      const keys = await redis.keys(`${namespace}:*`);
      if (keys.length) await redis.del(...keys);
    }
  });
});

it.skipIf(!url)("invalidates cached previews on new activity and rejects a stale in-flight cache write", async () => {
  if (!url || new URL(url).hostname !== "127.0.0.1") throw new Error("local_test_redis_required");
  const redis = new Redis({ url, token: "synthetic-local-redis-test", responseEncoding: false });
  const namespace = "test:inbox:" + randomUUID();
  let receivedAt = new Date();
  let text = "First message";
  let duringRead: (() => Promise<void>) | null = null;
  const loadConversation = vi.fn(async () => {
    const event = { channel: "facebook" as const, role: "customer" as const, eventType: "customer_message" as const, externalConversationKey: "synthetic-customer", externalMessageKey: text, externalReplyToMessageKey: null, text, attachments: [], receivedAt };
    if (duringRead) { const task = duringRead; duringRead = null; await task(); }
    return { channel: "facebook" as const, events: [event], complete: true, incompleteReason: null, characters: text.length, turnsConsidered: 1 };
  });
  const inbox = new MetaInbox({ redis, namespace, encryptionKey: "synthetic-key-".repeat(4), idHashSecret: "synthetic-hash", pageId: "synthetic-page", context: { loadConversation }, discover: async () => [] });
  try {
    await inbox.index("synthetic-customer", receivedAt);
    const first = await inbox.list();
    const id = first.items[0].inboxId;
    expect(first.items[0].timeline[0].text).toBe("First message");
    expect(await redis.ttl(namespace + ":inbox:meta:cache:" + id)).toBeGreaterThan(60);
    await inbox.list();
    expect(loadConversation).toHaveBeenCalledTimes(1);
    receivedAt = new Date(receivedAt.getTime() + 1000);
    await inbox.index("synthetic-customer", receivedAt);
    duringRead = async () => {
      receivedAt = new Date(receivedAt.getTime() + 1000);
      text = "New activity";
      await inbox.index("synthetic-customer", receivedAt);
    };
    await inbox.list();
    expect(await redis.get(namespace + ":inbox:meta:cache:" + id)).toBeNull();
    expect((await inbox.list()).items[0].timeline[0].text).toBe("New activity");
  } finally { const keys = await redis.keys(namespace + ":*"); if (keys.length) await redis.del(...keys); }
});
