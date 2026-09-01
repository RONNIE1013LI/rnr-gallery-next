import { describe, expect, it } from "vitest";
import {
  createWebsitePublicUpdatesReader,
  type WebsitePublicUpdateRecord,
} from "./public-updates";

const cursorSecret = "website-public-updates-secret-that-is-long-enough";
const conversationId = "00000000-0000-4000-8000-000000000001";
const timestamp = new Date("2026-08-21T00:00:00.000Z");

function record(input: Partial<WebsitePublicUpdateRecord> = {}): WebsitePublicUpdateRecord {
  return {
    source: "event",
    id: "00000000-0000-4000-8000-000000000010",
    role: "customer",
    text: "I need a quote for a banner.",
    createdAt: timestamp,
    orderingKey: "2026-08-21T00:00:00.000123Z",
    state: "pending",
    ...input,
  };
}

describe("website public updates", () => {
  it("emits a session-scoped message key for reconciling persisted customer messages", async () => {
    const reader = createWebsitePublicUpdatesReader({
      cursorSecret,
      repository: {
        async listWebsitePublicUpdates() {
          return [record({ messageKeyHash: "b".repeat(64) })];
        },
      },
    });

    const first = await reader.read({
      conversationId,
      sessionKeyHash: "a".repeat(64),
      cursor: null,
      limit: 10,
    });
    const second = await reader.read({
      conversationId,
      sessionKeyHash: "c".repeat(64),
      cursor: null,
      limit: 10,
    });

    expect(first.events[0]).toMatchObject({
      role: "customer",
      messageKey: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(first.events[0]?.messageKey).not.toBe(second.events[0]?.messageKey);
    expect(JSON.stringify(first)).not.toContain("b".repeat(64));
  });

  it("uses an opaque signed cursor bound to one resolved session", async () => {
    const calls: unknown[] = [];
    const reader = createWebsitePublicUpdatesReader({
      cursorSecret,
      repository: {
        async listWebsitePublicUpdates(input) {
          calls.push(input);
          return [
            record(),
            record({
              source: "assistant",
              id: "00000000-0000-4000-8000-000000000020",
              role: "assistant",
              text: "Please share the size and required date.",
              state: "committed_assistant",
            }),
          ];
        },
      },
    });

    const first = await reader.read({
      conversationId,
      sessionKeyHash: "a".repeat(64),
      cursor: null,
      limit: 1,
    });

    expect(first.events).toEqual([{
      eventKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      role: "customer",
      text: "I need a quote for a banner.",
      createdAt: "2026-08-21T00:00:00.000Z",
      state: "pending",
    }]);
    expect(first.hasMore).toBe(true);
    expect(first.cursor).not.toContain(conversationId);
    expect(first.cursor).not.toContain("00000000-0000-4000-8000-000000000010");
    expect(first.cursor).not.toContain("2026-08-21");

    await reader.read({
      conversationId,
      sessionKeyHash: "a".repeat(64),
      cursor: first.cursor,
      limit: 1,
    });
    expect(calls[1]).toMatchObject({
      conversationId,
      after: {
        orderingKey: "2026-08-21T00:00:00.000123Z",
        source: "event",
        id: "00000000-0000-4000-8000-000000000010",
      },
      limit: 2,
    });

    await expect(reader.read({
      conversationId,
      sessionKeyHash: "b".repeat(64),
      cursor: first.cursor,
      limit: 1,
    })).rejects.toThrow("website_public_updates_cursor_invalid");
    await expect(reader.read({
      conversationId,
      sessionKeyHash: "a".repeat(64),
      cursor: `${first.cursor}tampered`,
      limit: 1,
    })).rejects.toThrow("website_public_updates_cursor_invalid");
  });

  it("uses session-scoped aliases and permits only bounded public states", async () => {
    const reader = createWebsitePublicUpdatesReader({
      cursorSecret,
      repository: {
        async listWebsitePublicUpdates() {
          return [
            record({ state: "recovery" }),
            record({
              source: "assistant",
              id: "00000000-0000-4000-8000-000000000021",
              role: "assistant",
              text: "Our team will review this and reply here.",
              state: "review",
            }),
            record({
              source: "event",
              id: "00000000-0000-4000-8000-000000000022",
              role: "staff",
              text: "We can help with that.",
              state: "human_outbound",
            }),
          ];
        },
      },
    });

    const first = await reader.read({ conversationId, sessionKeyHash: "a".repeat(64), cursor: null, limit: 10 });
    const second = await reader.read({ conversationId, sessionKeyHash: "b".repeat(64), cursor: null, limit: 10 });

    expect(first.events.map((event: { state: string }) => event.state)).toEqual(["recovery", "human_outbound", "review"]);
    expect(first.events[0]?.eventKey).not.toBe(second.events[0]?.eventKey);
    expect(JSON.stringify(first)).not.toMatch(/provider|policy|attempt|conversation|reviewId|secret/i);
  });
});
