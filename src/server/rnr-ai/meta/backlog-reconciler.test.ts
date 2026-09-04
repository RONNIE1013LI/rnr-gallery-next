import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { InMemoryReplyRuntimeStore } from "../runtime-store/in-memory-reply-runtime-store";
import { createBacklogReconciler } from "./backlog-reconciler";
import type { MetaConversationLocator } from "./context-provider";
import type { MetaConversationEvent, MetaConversationSnapshot, MetaHistoryEvent } from "./types";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const from = "2026-09-03T00:00:00.000Z";
const to = "2026-09-04T00:00:00.000Z";

function locator(id: string): MetaConversationLocator {
  return { channel: "facebook", externalConversationKey: id, pageId: "page-1" };
}

function history(id: string, role: "customer" | "staff", text: string, minute: number): MetaHistoryEvent {
  return {
    channel: "facebook",
    role,
    eventType: role === "staff" ? "human_outbound" : "customer_message",
    externalConversationKey: id,
    externalMessageKey: `${id}-${minute}`,
    externalReplyToMessageKey: null,
    text,
    attachments: [],
    receivedAt: new Date(Date.parse(from) + minute * 60_000),
  };
}

function snapshot(id: string, events: readonly MetaHistoryEvent[]): MetaConversationSnapshot {
  return { channel: "facebook", events, complete: true, incompleteReason: null, characters: 10, turnsConsidered: events.length };
}

async function lease(store: InMemoryReplyRuntimeStore, revision = 1) {
  await store.enqueueBacklog(revision, { from, to, maxConversations: 100 });
  return (await store.claimBacklog(30_000))!;
}

describe("BacklogReconciler", () => {
  it("processes at most 100 conversations and merges only the latest consecutive customer fragments", async () => {
    const store = new InMemoryReplyRuntimeStore({ now: () => Date.parse(to) });
    const locators = Array.from({ length: 101 }, (_, index) => locator(`conversation-${index}`));
    const processEvent = vi.fn(async (input: MetaConversationEvent) => {
      void input;
      return { acknowledged: true as const, status: "delivery_candidate_disabled" as const };
    });
    const reconciler = createBacklogReconciler({
      store,
      controlIsOn: async () => true,
      listConversations: async () => locators,
      loadConversation: async (item) => snapshot(item.externalConversationKey, [
        history(item.externalConversationKey, "staff", "Earlier answer", 1),
        history(item.externalConversationKey, "customer", "A2 please", 2),
        history(item.externalConversationKey, "customer", "with two people", 3),
      ]),
      processEvent,
      hashExternalKey: hash,
      now: () => new Date(to),
    });
    const result = await reconciler.run(await lease(store));
    expect(result).toMatchObject({ processed: 100, stoppedBecauseOff: false });
    expect(processEvent).toHaveBeenCalledTimes(100);
    expect(processEvent.mock.calls[0][0].text).toBe("A2 please\nwith two people");
    expect(processEvent.mock.calls[0][0].externalMessageKey).toBe("conversation-0-3");
  });

  it("skips later staff replies, takeover, old history, image-only backlog and duplicate results", async () => {
    const store = new InMemoryReplyRuntimeStore({ now: () => Date.parse(to) });
    await store.setTakeover({ conversationKeyHash: hash("takeover"), active: true, source: "admin", changedAt: to });
    const events = new Map<string, MetaConversationSnapshot>([
      ["staff-last", snapshot("staff-last", [history("staff-last", "customer", "Hi", 1), history("staff-last", "staff", "Answered", 2)])],
      ["takeover", snapshot("takeover", [history("takeover", "customer", "Hi", 2)])],
      ["old", snapshot("old", [{ ...history("old", "customer", "Hi", 1), receivedAt: new Date("2026-09-02T23:59:59Z") }])],
      ["image", snapshot("image", [{ ...history("image", "customer", "See photo", 2), attachments: [{ ordinal: 0, kind: "image" }] }])],
      ["duplicate", snapshot("duplicate", [history("duplicate", "customer", "Hi", 2)])],
    ]);
    const processEvent = vi.fn(async (input: MetaConversationEvent) => {
      void input;
      return { acknowledged: true as const, status: "duplicate" as const };
    });
    const reconciler = createBacklogReconciler({
      store,
      controlIsOn: async () => true,
      listConversations: async () => [...events.keys()].map(locator),
      loadConversation: async (item) => events.get(item.externalConversationKey)!,
      processEvent,
      hashExternalKey: hash,
      now: () => new Date(to),
    });
    const result = await reconciler.run(await lease(store));
    expect(result).toMatchObject({ processed: 0, skipped: 5 });
    expect(processEvent).toHaveBeenCalledTimes(1);
  });

  it("stops immediately when effective control switches OFF", async () => {
    const store = new InMemoryReplyRuntimeStore({ now: () => Date.parse(to) });
    let checks = 0;
    const processEvent = vi.fn(async (input: MetaConversationEvent) => {
      void input;
      return { acknowledged: true as const, status: "delivery_candidate_disabled" as const };
    });
    const reconciler = createBacklogReconciler({
      store,
      controlIsOn: async () => checks++ === 0,
      listConversations: async () => [locator("one"), locator("two")],
      loadConversation: async (item) => snapshot(item.externalConversationKey, [history(item.externalConversationKey, "customer", "Hi", 2)]),
      processEvent,
      hashExternalKey: hash,
      now: () => new Date(to),
    });
    const result = await reconciler.run(await lease(store));
    expect(result).toMatchObject({ processed: 0, stoppedBecauseOff: true });
    expect(processEvent).not.toHaveBeenCalled();
  });

  it.each(["delivery_sent", "delivery_blocked", "delivery_uncertain"] as const)(
    "counts %s as an attempted backlog item",
    async (status) => {
      const store = new InMemoryReplyRuntimeStore({ now: () => Date.parse(to) });
      const reconciler = createBacklogReconciler({
        store,
        controlIsOn: async () => true,
        listConversations: async () => [locator("one")],
        loadConversation: async () => snapshot("one", [history("one", "customer", "Hi", 2)]),
        processEvent: async () => ({ acknowledged: true, status }),
        hashExternalKey: hash,
        now: () => new Date(to),
      });
      await expect(reconciler.run(await lease(store))).resolves.toMatchObject({ processed: 1, skipped: 0 });
    },
  );
});
