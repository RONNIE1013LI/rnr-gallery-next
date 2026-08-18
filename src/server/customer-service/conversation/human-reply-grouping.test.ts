import { describe, expect, it } from "vitest";
import { canAppendHumanReply } from "./human-reply-grouping";

describe("human reply grouping", () => {
  const group = {
    conversationId: "conversation-a",
    lastOutboundAt: new Date("2026-08-18T00:00:00.000Z"),
    messageCount: 1,
    characterCount: 20,
    replyToExternalMessageKeyHash: null as string | null,
  };

  it("accepts the 90-second edge in the same uninterrupted conversation", () => {
    expect(canAppendHumanReply({
      group,
      conversationId: "conversation-a",
      receivedAt: new Date("2026-08-18T00:01:30.000Z"),
      textLength: 10,
      interveningCustomer: false,
      replyToExternalMessageKeyHash: null,
      windowMs: 90_000,
    })).toBe(true);
  });

  it.each([
    ["another conversation", { conversationId: "conversation-b" }],
    ["expired window", { receivedAt: new Date("2026-08-18T00:01:30.001Z") }],
    ["customer interruption", { interveningCustomer: true }],
    ["sixth message", { group: { ...group, messageCount: 5 } }],
    ["character overflow", { textLength: 2_381 }],
  ])("rejects %s", (_label, override) => {
    expect(canAppendHumanReply({
      group,
      conversationId: "conversation-a",
      receivedAt: new Date("2026-08-18T00:00:30.000Z"),
      textLength: 10,
      interveningCustomer: false,
      replyToExternalMessageKeyHash: null,
      windowMs: 90_000,
      ...override,
    })).toBe(false);
  });

  it("never combines staff messages that target different customer messages", () => {
    expect(canAppendHumanReply({
      group: { ...group, replyToExternalMessageKeyHash: "11".repeat(32) },
      conversationId: "conversation-a",
      receivedAt: new Date("2026-08-18T00:00:30.000Z"),
      textLength: 10,
      interveningCustomer: false,
      replyToExternalMessageKeyHash: "22".repeat(32),
      windowMs: 90_000,
    })).toBe(false);
  });
});
