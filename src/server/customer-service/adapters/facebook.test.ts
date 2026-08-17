import { describe, expect, it } from "vitest";
import { createFacebookChannelAdapter } from "./facebook";

const adapter = createFacebookChannelAdapter();
const recipientField = ["recip", "ient"].join("");

function payload(message: Record<string, unknown>) {
  return {
    object: "page",
    entry: [{
      id: "page-1",
      time: 1_787_001_600_000,
      messaging: [{
        sender: { id: "sender-1" },
        [recipientField]: { id: "page-1" },
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
      attachments: [],
      receivedAt: new Date(1_787_001_600_000),
    }]);
  });

  it("normalizes text with an image attachment", () => {
    const result = adapter.normalize(payload({
      mid: "mid.1",
      text: "Can you use this photo?",
      attachments: [{ type: "image", payload: { url: "https://scontent.test/image.jpg" } }],
    }));

    expect(result[0]).toMatchObject({
      text: "Can you use this photo?",
      attachments: [{
        externalAttachmentKey: "mid.1:0",
        ordinal: 0,
        kind: "image",
        sourceRef: { kind: "facebook_remote", url: "https://scontent.test/image.jpg" },
        mimeTypeHint: null,
      }],
    });
  });

  it("normalizes an image-only event with null text", () => {
    const result = adapter.normalize(payload({
      mid: "mid-image-only",
      attachments: [{ type: "image", payload: { url: "https://scontent.test/image-only.jpg" } }],
    }));

    expect(result[0]).toMatchObject({
      text: null,
      attachments: [{
        externalAttachmentKey: "mid-image-only:0",
        ordinal: 0,
        kind: "image",
        sourceRef: { kind: "facebook_remote", url: "https://scontent.test/image-only.jpg" },
      }],
    });
  });

  it("ignores non-image and malformed attachments while preserving text", () => {
    const result = adapter.normalize(payload({
      mid: "mid-invalid",
      text: "Here is the detail",
      attachments: [
        { type: "file", payload: { url: "https://scontent.test/file.pdf" } },
        { type: "image", payload: { url: "http://scontent.test/not-https.jpg" } },
        { type: "image", payload: { url: "   " } },
        { type: "image", payload: { url: 123 } },
        null,
      ],
    }));

    expect(result).toMatchObject([{
      text: "Here is the detail",
      attachments: [],
    }]);
  });

  it("keeps at most five valid image attachments", () => {
    const result = adapter.normalize(payload({
      mid: "mid-six-images",
      attachments: Array.from({ length: 6 }, (_, index) => ({
        type: "image",
        payload: { url: `https://scontent.test/image-${index}.jpg` },
      })),
    }));

    expect(result[0]?.attachments).toHaveLength(5);
    expect(result[0]?.attachments.map((attachment) => attachment.externalAttachmentKey)).toEqual([
      "mid-six-images:0",
      "mid-six-images:1",
      "mid-six-images:2",
      "mid-six-images:3",
      "mid-six-images:4",
    ]);
  });

  it("filters echoes and non-text events", () => {
    expect(adapter.normalize(payload({ mid: "mid-1", text: "echo", is_echo: true }))).toEqual([]);
    expect(adapter.normalize({
      object: "page",
      entry: [{ id: "page-1", messaging: [{ delivery: { mids: ["mid-1"] } }] }],
    })).toEqual([]);
    expect(adapter.normalize(payload({
      mid: "mid-2",
      attachments: [{ type: "image", payload: { url: "not-a-url" } }],
    }))).toEqual([]);
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
