import { describe, expect, it } from "vitest";
import { createFacebookChannelAdapter, normalizeFacebookMetaEvents } from "./facebook";

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
  it("maps the existing normalization into the common Meta event contract", () => {
    expect(normalizeFacebookMetaEvents(payload({ mid: "mid-common", text: "Hello" }))).toEqual([{
      channel: "facebook",
      role: "customer",
      eventType: "customer_message",
      externalConversationKey: "sender-1",
      externalMessageKey: "mid-common",
      externalReplyToMessageKey: null,
      text: "Hello",
      attachments: [],
      receivedAt: new Date(1_787_001_600_000),
    }]);
  });

  it("normalizes supported customer text", () => {
    expect(adapter.normalize(payload({ mid: "mid-1", text: "How do I prepare my photos?" }))).toEqual([{
      channel: "facebook",
      role: "customer",
      eventType: "customer_message",
      externalConversationKey: "sender-1",
      externalMessageKey: "mid-1",
      externalReplyToMessageKey: null,
      text: "How do I prepare my photos?",
      attachments: [],
      receivedAt: new Date(1_787_001_600_000),
    }]);
  });

  it("normalizes the sanitized real Test Page message_echoes shape as staff context", () => {
    const result = adapter.normalize({
      object: "page",
      entry: [{
        id: "page-1",
        messaging: [{
          sender: { id: "page-1" },
          [recipientField]: { id: "customer-1" },
          timestamp: 1_787_001_600_000,
          message: {
            app_id: "test-app",
            mid: "echo-1",
            text: "Which size would you like?",
            is_echo: true,
            reply_to: { mid: "customer-mid-1" },
          },
        }],
      }],
    });

    expect(result).toEqual([{
      channel: "facebook",
      role: "staff",
      eventType: "human_outbound",
      externalConversationKey: "customer-1",
      externalMessageKey: "echo-1",
      externalReplyToMessageKey: "customer-mid-1",
      text: "Which size would you like?",
      attachments: [],
      receivedAt: new Date(1_787_001_600_000),
    }]);
  });

  it("captures an attachment-only staff echo as context without retaining its URL", () => {
    const result = adapter.normalize({
      object: "page",
      entry: [{
        id: "page-1",
        messaging: [{
          sender: { id: "page-1" },
          [recipientField]: { id: "customer-1" },
          timestamp: 1_787_001_600_000,
          message: {
            mid: "echo-image-1",
            is_echo: true,
            attachments: [{ type: "image", payload: { url: "https://scontent.test/private.jpg" } }],
          },
        }],
      }],
    });

    expect(result).toEqual([expect.objectContaining({
      role: "staff",
      eventType: "human_outbound",
      text: "[Staff sent an attachment]",
      attachments: [],
    })]);
    expect(JSON.stringify(result)).not.toContain("private.jpg");
  });

  it("fails closed when an echo sender is not the entry Page", () => {
    expect(adapter.normalize({
      object: "page",
      entry: [{
        id: "page-1",
        messaging: [{
          sender: { id: "other-page" },
          [recipientField]: { id: "customer-1" },
          timestamp: 1_787_001_600_000,
          message: { mid: "echo-wrong-page", text: "Hello", is_echo: true },
        }],
      }],
    })).toEqual([]);
  });

  it("fails closed when a staff echo has no customer recipient", () => {
    expect(adapter.normalize({
      object: "page",
      entry: [{
        id: "page-1",
        messaging: [{
          sender: { id: "page-1" },
          timestamp: 1_787_001_600_000,
          message: { mid: "echo-1", text: "Which size would you like?", is_echo: true },
        }],
      }],
    })).toEqual([]);
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

  it("preserves safe unsupported and malformed metadata without retaining source URLs", () => {
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
      attachments: [
        { ordinal: 0, kind: "unsupported", failureCode: "unsupported_attachment", sourceRef: null },
        { ordinal: 1, kind: "unsupported", failureCode: "invalid_image_source", sourceRef: null },
        { ordinal: 2, kind: "unsupported", failureCode: "invalid_image_source", sourceRef: null },
        { ordinal: 3, kind: "unsupported", failureCode: "invalid_image_source", sourceRef: null },
        { ordinal: 4, kind: "unsupported", failureCode: "malformed_attachment", sourceRef: null },
      ],
    }]);
    expect(JSON.stringify(result)).not.toContain("file.pdf");
    expect(JSON.stringify(result)).not.toContain("not-https.jpg");
  });

  it("persists a file-only event for human review", () => {
    const result = adapter.normalize(payload({
      mid: "mid-file-only",
      attachments: [{ type: "file", payload: { url: "https://scontent.test/private.pdf" } }],
    }));

    expect(result).toMatchObject([{
      text: null,
      attachments: [{
        externalAttachmentKey: "mid-file-only:0",
        ordinal: 0,
        kind: "unsupported",
        failureCode: "unsupported_attachment",
        sourceRef: null,
      }],
    }]);
    expect(JSON.stringify(result)).not.toContain("private.pdf");
  });

  it("retains safe overflow metadata after five valid image sources", () => {
    const result = adapter.normalize(payload({
      mid: "mid-six-images",
      attachments: Array.from({ length: 6 }, (_, index) => ({
        type: "image",
        payload: { url: `https://scontent.test/image-${index}.jpg` },
      })),
    }));

    expect(result[0]?.attachments).toHaveLength(6);
    expect(result[0]?.attachments.map((attachment) => attachment.externalAttachmentKey)).toEqual([
      "mid-six-images:0",
      "mid-six-images:1",
      "mid-six-images:2",
      "mid-six-images:3",
      "mid-six-images:4",
      "mid-six-images:5",
    ]);
    expect(result[0]?.attachments.slice(0, 5).every((attachment) => attachment.kind === "image")).toBe(true);
    expect(result[0]?.attachments[5]).toMatchObject({
      ordinal: 5,
      kind: "unsupported",
      sourceRef: null,
      failureCode: "too_many_attachments",
    });
    expect(JSON.stringify(result)).not.toContain("image-5.jpg");
  });

  it.each([
    ["file", { type: "file", payload: { url: "https://scontent.test/private.pdf" } }, "unsupported_attachment", "private.pdf"],
    ["invalid image URL", { type: "image", payload: { url: "http://scontent.test/private.jpg" } }, "invalid_image_source", "private.jpg"],
    ["malformed attachment", null, "malformed_attachment", ""],
  ] as const)("retains safe %s metadata after five valid image sources", (_label, trailingAttachment, failureCode, rawUrlFragment) => {
    const result = adapter.normalize(payload({
      mid: "mid-trailing-invalid",
      attachments: [
        ...Array.from({ length: 5 }, (_, index) => ({
          type: "image",
          payload: { url: `https://scontent.test/image-${index}.jpg` },
        })),
        trailingAttachment,
      ],
    }));

    expect(result[0]?.attachments).toHaveLength(6);
    expect(result[0]?.attachments.slice(0, 5).every((attachment) => attachment.kind === "image")).toBe(true);
    expect(result[0]?.attachments[5]).toMatchObject({
      ordinal: 5,
      kind: "unsupported",
      sourceRef: null,
      failureCode,
    });
    if (rawUrlFragment) expect(JSON.stringify(result)).not.toContain(rawUrlFragment);
  });

  it("filters non-message events", () => {
    expect(adapter.normalize({
      object: "page",
      entry: [{ id: "page-1", messaging: [{ delivery: { mids: ["mid-1"] } }] }],
    })).toEqual([]);
    expect(adapter.normalize(payload({
      mid: "mid-2",
      attachments: [{ type: "image", payload: { url: "not-a-url" } }],
    }))).toMatchObject([{ text: null, attachments: [{ kind: "unsupported" }] }]);
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
