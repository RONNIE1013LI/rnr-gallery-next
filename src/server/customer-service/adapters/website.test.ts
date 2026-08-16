import { describe, expect, it } from "vitest";
import { WebsiteChannelNotEnabledError, websiteChannelAdapter } from "./website";

describe("Website channel adapter", () => {
  it("keeps the channel contract disabled in Phase 1", () => {
    expect(websiteChannelAdapter.channel).toBe("website");
    expect(() => websiteChannelAdapter.normalize({ text: "hello" })).toThrow(
      WebsiteChannelNotEnabledError,
    );
  });
});
