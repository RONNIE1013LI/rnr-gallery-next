import { describe, expect, it } from "vitest";
import {
  isWebsiteAnalyticsChannel,
  normalizeCountryCode,
  normalizeWebsiteClickIdTypes,
} from "./website-analytics";

describe("website analytics value contracts", () => {
  it.each([
    "google_ads",
    "meta_ads",
    "google_organic",
    "direct",
    "other",
  ])("accepts core channel %s", (channel) => {
    expect(isWebsiteAnalyticsChannel(channel)).toBe(true);
  });

  it.each(["bing_organic", "facebook_organic", "referral", "anything"])(
    "rejects non-core channel %s",
    (channel) => {
      expect(isWebsiteAnalyticsChannel(channel)).toBe(false);
    },
  );

  it.each([
    ["nz", "NZ"],
    ["AU", "AU"],
    [" us ", "US"],
    [null, null],
    ["", null],
    ["UNKNOWN", null],
    ["N1", null],
  ])("normalizes country %s", (input, expected) => {
    expect(normalizeCountryCode(input)).toBe(expected);
  });

  it("deduplicates allowlisted click ID types", () => {
    expect(normalizeWebsiteClickIdTypes([
      "fbclid",
      "gclid",
      "fbclid",
      "unknown",
      1,
    ])).toEqual(["gclid", "fbclid"]);
  });
});
