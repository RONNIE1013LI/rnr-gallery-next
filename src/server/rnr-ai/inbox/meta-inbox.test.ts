import { describe, expect, it, vi } from "vitest";
import type { Redis } from "@upstash/redis";
import { MetaInbox, metaInboxId } from "./meta-inbox";
import { createHmac } from "node:crypto";

describe("Meta inbox readthrough", () => {
  it("stores encrypted locators, uses actual outbound as neutral Page reply and caches Graph reads", async () => {
    const values = new Map<string, unknown>();
    let ids: string[] = [];
    const redis = {
      get: vi.fn(async (key: string) => values.get(key) ?? null),
      set: vi.fn(async (key: string, value: unknown, options?: { nx?: boolean }) => { if (options?.nx && values.has(key)) return null; values.set(key, value); return "OK"; }),
      del: vi.fn(async (key: string) => values.delete(key)),
      eval: vi.fn(async (_script: string, keys: string[], args: unknown[]) => { values.set(keys[0], args[2]); ids = [...new Set([...ids, String(args[0])])]; return 1; }),
      zadd: vi.fn(async (_key: string, value: { member: string }) => { ids = [...new Set([...ids, value.member])]; }),
      zrange: vi.fn(async () => ids), zremrangebyscore: vi.fn(),
    };
    const loadConversation = vi.fn(async () => ({ channel: "facebook" as const, events: [{ channel: "facebook" as const, role: "staff" as const, eventType: "human_outbound" as const, externalConversationKey: "private-psid", externalMessageKey: "actual-sent-id", externalReplyToMessageKey: null, text: "Actually sent", attachments: [], receivedAt: new Date("2026-09-06") }], complete: true, incompleteReason: null, characters: 13, turnsConsidered: 1 }));
    const inbox = new MetaInbox({ redis: redis as unknown as Redis, namespace: "test", encryptionKey: "e".repeat(32), idHashSecret: "secret", pageId: "page", context: { loadConversation }, discover: async () => [] });
    await inbox.index("private-psid", new Date());
    expect(JSON.stringify([...values])).not.toContain("private-psid");
    const expected = metaInboxId(createHmac("sha256", "secret").update("private-psid").digest("hex"));
    const first = (await inbox.list()).items[0];
    expect(first).toMatchObject({ inboxId: expected, status: "page_replied", draftText: null, humanReplyReceived: false });
    expect(first.timeline[0]).toMatchObject({ role: "staff", pageOutbound: true, text: "Actually sent" });
    expect(JSON.stringify([...values])).not.toContain("Actually sent");
    await inbox.list();
    expect(loadConversation).toHaveBeenCalledTimes(1);
    expect(await inbox.resolve("0".repeat(64))).toBeNull();
    const page = await inbox.timeline({ inboxId: expected, cursor: `meta:${expected}`, limit: 50 });
    expect(page.events[0].text).toBe("Actually sent");
    await expect(inbox.timeline({ inboxId: expected, cursor: `meta:${"0".repeat(64)}`, limit: 50 })).rejects.toThrow("reply_assistant_timeline_cursor_invalid");
  });
});
