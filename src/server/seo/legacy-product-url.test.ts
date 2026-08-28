import { describe, expect, it } from "vitest";
import { buildLegacyProductUrl } from "./legacy-product-url";

describe("buildLegacyProductUrl", () => {
  it("preserves supported gallery and review state on the canonical product URL", () => {
    expect(buildLegacyProductUrl("digital-oil-painting-canvas", {
      design: "design-123",
      rnr_design: ["legacy-456", "ignored"],
      reviews: "2",
    })).toBe(
      "/products/digital-oil-painting-canvas?design=design-123&rnr_design=legacy-456&reviews=2",
    );
  });

  it("does not forward unrelated query parameters", () => {
    expect(buildLegacyProductUrl("roll-up-banner", {
      coupon: "not-forwarded",
    })).toBe("/products/roll-up-banner");
  });

  it("preserves paid-click and UTM attribution while filtering unrelated parameters", () => {
    expect(buildLegacyProductUrl("roll-up-banner", {
      utm_source: "google",
      utm_campaign: ["winter-canvas", "ignored"],
      utm_content: "ad-1",
      gclid: "google-click",
      gbraid: "google-braid",
      wbraid: "google-web-braid",
      fbclid: "meta-click",
      coupon: "not-forwarded",
    })).toBe(
      "/products/roll-up-banner?utm_source=google&utm_campaign=winter-canvas&utm_content=ad-1&gclid=google-click&gbraid=google-braid&wbraid=google-web-braid&fbclid=meta-click",
    );
  });
});
