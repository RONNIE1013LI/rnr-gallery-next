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
    actionEligible: true,
    status: "received",
    latestAttemptId: null,
    draftText: null,
    gateResult: null,
    attachmentCount: 0,
    imageAnalysisStatus: "not_applicable",
    imageAssessmentSummary: null,
    humanReplyReceived: false,
    review: null,
    hasEarlierTimeline: false,
    includeInTimeline: true,
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
    expect(items[0]?.websiteReview).toEqual({
      id: "review-1",
      status: "open",
      generation: 2,
      selector: "selector-2",
    });
  });

  it("keeps the newest open customer review active ahead of a newer resolved review", () => {
    const items = projectCustomerInbox([
      row({
        conversationId: "conversation-open",
        eventId: "event-open",
        messageId: "message-open",
        receivedAt: "2026-09-01T07:10:00.000Z",
        review: { id: "review-open", status: "open", generation: 2, selector: "selector-open" },
      }),
      row({
        conversationId: "conversation-resolved",
        eventId: "event-resolved",
        messageId: "message-resolved",
        receivedAt: "2026-09-01T07:20:00.000Z",
        review: { id: "review-resolved", status: "resolved", generation: 3, selector: "selector-resolved" },
      }),
    ]);

    expect(items[0]?.websiteReview).toEqual({
      id: "review-open",
      status: "open",
      generation: 2,
      selector: "selector-open",
    });
  });

  it("selects the chronologically newest open review across conversation-local generations", () => {
    const items = projectCustomerInbox([
      row({
        conversationId: "conversation-old-generation",
        eventId: "event-old-generation",
        receivedAt: "2026-09-01T07:10:00.000Z",
        review: { id: "review-old", status: "open", generation: 10, selector: "selector-old" },
      }),
      row({
        conversationId: "conversation-new-generation",
        eventId: "event-new-generation",
        receivedAt: "2026-09-01T07:20:00.000Z",
        review: { id: "review-new", status: "open", generation: 1, selector: "selector-new" },
      }),
    ]);

    expect(items[0]?.websiteReview?.id).toBe("review-new");
  });

  it("selects the newest eligible action and carries its complete action state", () => {
    const eligibleAction = {
      ...row({
        eventId: "event-eligible",
        messageId: "message-eligible",
        receivedAt: "2026-09-01T07:10:00.000Z",
      }),
      actionEligible: true,
      status: "draft_ready",
      latestAttemptId: "attempt-eligible",
      draftText: "Eligible draft",
      hasEarlierTimeline: true,
    };
    const newerIneligibleAction = {
      ...row({
        eventId: "event-ineligible",
        messageId: "message-ineligible",
        receivedAt: "2026-09-01T07:20:00.000Z",
      }),
      actionEligible: false,
      status: "received",
      latestAttemptId: null,
      draftText: null,
      hasEarlierTimeline: false,
    };

    const items = projectCustomerInbox([eligibleAction, newerIneligibleAction]);

    expect(items[0]).toMatchObject({
      latestMessageId: "message-eligible",
      status: "draft_ready",
      latestAttemptId: "attempt-eligible",
      draftText: "Eligible draft",
      hasEarlierTimeline: true,
    });
  });

  it("can project an eligible action outside the bounded visible timeline", () => {
    const actionOutsideTimeline = {
      ...row({
        eventId: "action-outside-timeline",
        messageId: "message-action",
        receivedAt: "2026-09-01T07:00:00.000Z",
      }),
      actionEligible: true,
      status: "draft_ready",
      latestAttemptId: "attempt-action",
      draftText: "Older actionable draft",
      includeInTimeline: false,
    };
    const visibleNewestEvent = {
      ...row({
        eventId: "visible-event",
        messageId: null,
        role: "assistant",
        text: "Newest bounded event",
        receivedAt: "2026-09-01T08:00:00.000Z",
      }),
      actionEligible: false,
      includeInTimeline: true,
    };

    const items = projectCustomerInbox([actionOutsideTimeline, visibleNewestEvent]);

    expect(items[0]?.latestMessageId).toBe("message-action");
    expect(items[0]?.timeline.map((event) => event.text)).toEqual(["Newest bounded event"]);
    expect(items[0]?.lastActivityAt).toBe("2026-09-01T08:00:00.000Z");
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
