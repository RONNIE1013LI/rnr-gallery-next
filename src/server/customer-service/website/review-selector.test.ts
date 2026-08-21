import { describe, expect, it } from "vitest";
import {
  createWebsiteReviewSelector,
  verifyWebsiteReviewSelector,
} from "./review-selector";

const secret = "website-review-selector-test-secret-at-least-32-bytes";
const review = {
  reviewId: "33333333-3333-4333-8333-333333333333",
  generation: 4,
  openedAt: new Date("2026-08-21T00:00:00.000Z"),
};

describe("website review selector", () => {
  it("issues an opaque authenticated selector without exposing the review id", () => {
    const selector = createWebsiteReviewSelector({ ...review, secret });

    expect(selector).toMatch(/^wrs1\.[a-z0-9]+\.[A-Za-z0-9_-]{43}$/);
    expect(selector).not.toContain(review.reviewId);
    expect(Buffer.from(selector, "base64url").toString("utf8")).not.toContain(review.reviewId);
    expect(verifyWebsiteReviewSelector({
      ...review,
      selector,
      secret,
      now: new Date("2026-08-22T00:00:00.000Z"),
    })).toBe(true);
  });

  it("rejects tampering, another generation, and expiry", () => {
    const selector = createWebsiteReviewSelector({ ...review, secret });

    expect(verifyWebsiteReviewSelector({
      ...review,
      selector: `${selector.slice(0, -1)}A`,
      secret,
      now: new Date("2026-08-22T00:00:00.000Z"),
    })).toBe(false);
    expect(verifyWebsiteReviewSelector({
      ...review,
      generation: review.generation + 1,
      selector,
      secret,
      now: new Date("2026-08-22T00:00:00.000Z"),
    })).toBe(false);
    expect(verifyWebsiteReviewSelector({
      ...review,
      selector,
      secret,
      now: new Date("2026-09-20T00:00:00.000Z"),
    })).toBe(false);
  });
});
