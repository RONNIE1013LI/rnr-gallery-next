import { describe, expect, it } from "vitest";
import { createFacebookChannelAdapter } from "./facebook";

const adapter = createFacebookChannelAdapter();

function payload(message: Record<string, unknown>) {
  return {
    object: "page",
    entry: [{
      id: "page-1",
      time: 1_787_001_600_000,
      messaging: [{
        sender: { id: "sender-1" },
        recipient: { id: "page-1" },
        timestamp: 1_787_001_600_000,
        message,
      }],
    }],
  };
}

describe("Facebook channel adapter", () => {
  it("normalizes supported customer text", () => {
    expect(adapter.normalize(payload({ mid: "mid-1", text: "How do I prepare my photos?" }))).toEqual([{
      channel: "facebook",
      externalConversationKey: "sender-1",
      externalMessageKey: "mid-1",
      text: "How do I prepare my photos?",
      receivedAt: new Date(1_787_001_600_000),
    }]);
  });

  it("filters echoes and non-text events", () => {
    expect(adapter.normalize(payload({ mid: "mid-1", text: "echo", is_echo: true }))).toEqual([]);
    expect(adapter.normalize({
      object: "page",
      entry: [{ id: "page-1", messaging: [{ delivery: { mids: ["mid-1"] } }] }],
    })).toEqual([]);
    expect(adapter.normalize(payload({ mid: "mid-2", attachments: [] }))).toEqual([]);
  });

  it("normalizes all valid messages in a batch", () => {
    const batch = {
      object: "page",
      entry: [{
        id: "page-1",
        messaging: [
          { sender: { id: "sender-1" }, timestamp: 1000, message: { mid: "m1", text: "First" } },
          { sender: { id: "sender-2" }, timestamp: 2000, message: { mid: "m2", text: "Second" } },
        ],
      }],
    };
    expect(adapter.normalize(batch).map((message) => message.externalMessageKey)).toEqual(["m1", "m2"]);
  });
});
