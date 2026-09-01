import { describe, expect, it } from "vitest";
import {
  mergeChangedInboxItems,
  projectCustomerInbox,
  type CustomerInboxProjectionRow,
} from "./customer-inbox";

const visitorA = "a".repeat(64);
const visitorB = "b".repeat(64);
const psid = "c".repeat(64);

function row(overrides: Partial<CustomerInboxProjectionRow> = {}): CustomerInboxProjectionRow {
  return {
    channel: "website",
    identity: { kind: "website_stable_visitor", keyHash: visitorA },
    conversationId: "conversation-1",
    sessionId: "session-1",
    eventId: "event-1",
    messageId: "message-1",
    role: "customer",
    text: "Roll-up",
    receivedAt: "2026-09-01T07:10:00.000Z",
    review: null,
    ...overrides,
  };
}

describe("one customer Inbox projection", () => {
  it("projects multiple Website conversations and sessions for one exact identity as one box", () => {
    const items = projectCustomerInbox([
      row(),
      row({
        conversationId: "conversation-2",
        sessionId: "session-2",
        eventId: "event-2",
        messageId: "message-2",
        text: "Canvas",
        receivedAt: "2026-09-01T07:20:00.000Z",
      }),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      channel: "website",
      latestMessageId: "message-2",
      lastActivityAt: "2026-09-01T07:20:00.000Z",
      unreadCount: 2,
    });
    expect(items[0]?.timeline.map((event) => ({
      conversationId: event.conversationId,
      sessionId: event.sessionId,
      text: event.text,
    }))).toEqual([
      { conversationId: "conversation-1", sessionId: "session-1", text: "Roll-up" },
      { conversationId: "conversation-2", sessionId: "session-2", text: "Canvas" },
    ]);
  });

  it("never merges two anonymous technical conversation identities", () => {
    const items = projectCustomerInbox([
      row({
        identity: { kind: "website_conversation", keyHash: visitorA },
      }),
      row({
        identity: { kind: "website_conversation", keyHash: visitorB },
        conversationId: "conversation-2",
        eventId: "event-2",
        messageId: "message-2",
      }),
    ]);

    expect(items).toHaveLength(2);
    expect(new Set(items.map((item) => item.inboxId)).size).toBe(2);
  });

  it("projects one Facebook box for the same PSID across technical conversations", () => {
    const items = projectCustomerInbox([
      row({
        channel: "facebook",
        identity: { kind: "facebook_psid", keyHash: psid },
        conversationId: "facebook-conversation-1",
        text: "Roll-up question",
      }),
      row({
        channel: "facebook",
        identity: { kind: "facebook_psid", keyHash: psid },
        conversationId: "facebook-conversation-2",
        eventId: "event-2",
        messageId: "message-2",
        text: "Canvas question",
        receivedAt: "2026-09-01T08:00:00.000Z",
      }),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]?.timeline.map((event) => event.text)).toEqual([
      "Roll-up question",
      "Canvas question",
    ]);
  });

  it("updates the same inboxId and moves that original box to the top", () => {
    const [customerAOld] = projectCustomerInbox([row()]);
    const [customerB] = projectCustomerInbox([row({
      identity: { kind: "website_stable_visitor", keyHash: visitorB },
      conversationId: "conversation-b",
      eventId: "event-b",
      messageId: "message-b",
      receivedAt: "2026-09-01T07:15:00.000Z",
    })]);
    const [customerANew] = projectCustomerInbox([row({
      conversationId: "conversation-2",
      eventId: "event-2",
      messageId: "message-2",
      receivedAt: "2026-09-01T07:20:00.000Z",
    })]);
    if (!customerAOld || !customerB || !customerANew) throw new Error("fixture_failed");

    const next = mergeChangedInboxItems([customerB, customerAOld], [customerANew]);

    expect(next.map((item) => item.inboxId)).toEqual([
      customerAOld.inboxId,
      customerB.inboxId,
    ]);
    expect(new Set(next.map((item) => item.inboxId)).size).toBe(2);
    expect(next[0]?.latestMessageId).toBe("message-2");
  });

  it("counts unread customer messages only after the latest human outbound event", () => {
    const items = projectCustomerInbox([
      row({ eventId: "event-1", messageId: "message-1", receivedAt: "2026-09-01T07:00:00.000Z" }),
      row({ eventId: "event-2", messageId: null, role: "assistant", text: "AI reply", receivedAt: "2026-09-01T07:01:00.000Z" }),
      row({ eventId: "event-3", messageId: "message-3", receivedAt: "2026-09-01T07:02:00.000Z" }),
      row({ eventId: "event-4", messageId: null, role: "staff", text: "Human reply", receivedAt: "2026-09-01T07:03:00.000Z" }),
      row({ eventId: "event-5", messageId: "message-5", receivedAt: "2026-09-01T07:04:00.000Z" }),
    ]);

    expect(items[0]?.unreadCount).toBe(1);
    expect(items[0]?.latestMessageId).toBe("message-5");
  });

  it("selects only the latest review state without creating another box", () => {
    const items = projectCustomerInbox([
      row({
        review: { id: "review-1", status: "open", generation: 1, selector: "selector-1" },
      }),
      row({
        conversationId: "conversation-2",
        eventId: "event-2",
        messageId: "message-2",
        receivedAt: "2026-09-01T07:20:00.000Z",
        review: { id: "review-1", status: "open", generation: 2, selector: "selector-2" },
      }),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]?.review).toEqual({
      id: "review-1",
      status: "open",
      generation: 2,
      selector: "selector-2",
    });
  });

  it("returns an opaque Inbox id without leaking the raw identity tuple", () => {
    const [item] = projectCustomerInbox([row()]);
    if (!item) throw new Error("fixture_failed");

    expect(item.inboxId).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(item)).not.toContain(visitorA);
    expect(Object.keys(item)).not.toContain("identity");
  });

  it("rejects a channel and identity-kind mismatch", () => {
    expect(() => projectCustomerInbox([row({
      channel: "facebook",
      identity: { kind: "website_stable_visitor", keyHash: visitorA },
    })])).toThrow("customer_inbox_identity_channel_mismatch");
  });
});
