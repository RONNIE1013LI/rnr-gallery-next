import { describe, expect, it } from "vitest";
import { WebsiteChannelNotEnabledError, websiteChannelAdapter } from "./website";

describe("Website channel adapter", () => {
  it("keeps the channel contract disabled in Phase 1", () => {
    expect(websiteChannelAdapter.channel).toBe("website");
    expect(() => websiteChannelAdapter.normalize({
      text: "hello",
      attachments: [{
        externalAttachmentKey: "website:0",
        ordinal: 0,
        kind: "image",
        sourceRef: { kind: "website_private_upload", storageKey: "private/attachment" },
        mimeTypeHint: "image/jpeg",
      }],
    })).toThrow(
      WebsiteChannelNotEnabledError,
    );
  });
});
