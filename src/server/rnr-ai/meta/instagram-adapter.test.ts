import { describe, expect, it } from "vitest";
import { normalizeInstagramMetaEvents } from "./instagram-adapter";

describe("Instagram adapter scope", () => {
  it("is disabled by default for the approved Facebook-first scope", () => {
    expect(normalizeInstagramMetaEvents({ object: "instagram", entry: [] })).toEqual([]);
  });

  it("ignores delivery, read and reaction events even when fixture parsing is enabled", () => {
    expect(normalizeInstagramMetaEvents({
      object: "instagram",
      entry: [{ messaging: [{ read: {} }, { delivery: {} }, { reaction: {} }] }],
    }, { enabled: true })).toEqual([]);
  });
});
