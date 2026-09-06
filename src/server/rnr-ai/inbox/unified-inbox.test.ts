import { describe, expect, it, vi } from "vitest";
import type { CustomerServiceRepository, SafeInboxItem } from "@/server/customer-service/repositories/customer-service-repository";
import { encodeReplyAssistantCursor } from "@/server/customer-service/live-updates";
import { createUnifiedInbox } from "./unified-inbox";
import type { MetaInbox } from "./meta-inbox";
const row = (id: string, status: string) => ({ inboxId: id, lastActivityAt: "2026-09-06", status } as SafeInboxItem);
describe("unified inbox", () => {
  it("refresh discovers new shared rows and replaces a historical draft by identity", async () => {
    const legacy = { listQueue: vi.fn(async () => ({ items: [row("same", "draft_ready")] })), listReplyAssistantUpdates: vi.fn(async () => ({ cursor: encodeReplyAssistantCursor(1), hasMore: false, queueItems: [], metrics: null, learningCandidates: null, caseMemories: null })) };
    let items = [row("same", "page_replied")];
    const meta = { list: vi.fn(async () => ({ items })) };
    const facade = createUnifiedInbox({ legacy: () => legacy as unknown as CustomerServiceRepository, meta: () => meta as unknown as MetaInbox, website: vi.fn(), websiteEnabled: false, metaEnabled: true });
    expect((await facade.listQueue(100)).items).toEqual(items);
    items = [...items, row("new", "awaiting_reply")];
    expect((await facade.listReplyAssistantUpdates(encodeReplyAssistantCursor(0), 100)).queueItems).toEqual(items);
    await expect(facade.listReplyAssistantUpdates("invalid", 100)).rejects.toThrow("invalid_reply_assistant_cursor");
    expect(legacy.listReplyAssistantUpdates).toHaveBeenCalledTimes(1);
  });
  it("does not pass shared Meta timeline cursors to historical storage", async () => {
    const legacy = vi.fn();
    const facade = createUnifiedInbox({ legacy, website: vi.fn(), websiteEnabled: false, metaEnabled: true, meta: () => ({ resolve: async () => ({ identityKeyHash: "hash" }), timeline: async () => { throw new Error("reply_assistant_timeline_cursor_invalid"); } }) as unknown as MetaInbox });
    await expect(facade.loadEarlierInboxTimeline({ inboxId: "same", cursor: "event:old", limit: 50 })).rejects.toThrow("reply_assistant_timeline_cursor_invalid");
    expect(legacy).not.toHaveBeenCalled();
  });
});
