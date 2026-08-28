import { describe, expect, it } from "vitest";
import { buildLegacyProductUrl } from "./legacy-product-url";

describe("buildLegacyProductUrl", () => {
  it("preserves gallery and review state on the canonical product URL", () => {
    expect(buildLegacyProductUrl("digital-oil-painting-canvas", {
      design: "design-123",
      rnr_design: ["legacy-456", "ignored"],
      reviews: "2",
    })).toBe(
      "/products/digital-oil-painting-canvas?design=design-123&rnr_design=legacy-456&rnr_design=ignored&reviews=2",
    );
  });

  it("preserves every legacy query parameter", () => {
    expect(buildLegacyProductUrl("roll-up-banner", {
      utm_source: "test",
      utm_campaign: "test",
      gclid: "test",
      x: "1",
      coupon: "not-forwarded",
    })).toBe(
      "/products/roll-up-banner?utm_source=test&utm_campaign=test&gclid=test&x=1&coupon=not-forwarded",
    );
  });
});
