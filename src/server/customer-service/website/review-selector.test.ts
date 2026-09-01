import { describe, expect, it } from "vitest";
import {
  createWebsiteReviewSelector,
  createWebsiteReviewSelectorRecord,
  createWebsiteReviewSelectorRecordForExpiry,
  verifyWebsiteReviewSelector,
} from "./review-selector";

const secret = "website-review-selector-test-secret-at-least-32-bytes";
const review = {
  reviewId: "33333333-3333-4333-8333-333333333333",
  generation: 4,
  openedAt: new Date("2026-08-21T00:00:00.000Z"),
};

const base64urlAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function padBitAliases(selector: string) {
  const canonicalLast = selector.at(-1);
  const canonicalIndex = canonicalLast ? base64urlAlphabet.indexOf(canonicalLast) : -1;
  if (canonicalIndex < 0 || canonicalIndex % 4 !== 0) {
    throw new Error("expected canonical 32-byte base64url MAC");
  }
  return [1, 2, 3].map((offset) => (
    `${selector.slice(0, -1)}${base64urlAlphabet[canonicalIndex + offset]}`
  ));
}

describe("website review selector", () => {
  it("issues an opaque authenticated selector without exposing the review id", () => {
    const selector = createWebsiteReviewSelector({
      ...review,
      secret,
      now: new Date("2026-08-21T12:00:00.000Z"),
    });

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
    const selector = createWebsiteReviewSelector({
      ...review,
      secret,
      now: new Date("2026-08-21T12:00:00.000Z"),
    });

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

  it("rejects non-canonical base36 and base64url aliases of a valid selector", () => {
    const selector = createWebsiteReviewSelector({
      ...review,
      secret,
      now: new Date("2026-08-21T12:00:00.000Z"),
    });
    const [version, expiry, mac] = selector.split(".");
    const leadingZeroAlias = `${version}.0${expiry}.${mac}`;

    expect(verifyWebsiteReviewSelector({
      ...review,
      selector: leadingZeroAlias,
      secret,
      now: new Date("2026-08-22T00:00:00.000Z"),
    })).toBe(false);
    for (const alias of padBitAliases(selector)) {
      expect(verifyWebsiteReviewSelector({
        ...review,
        selector: alias,
        secret,
        now: new Date("2026-08-22T00:00:00.000Z"),
      })).toBe(false);
    }
  });

  it("renews in stable daily windows without reviving an expired captured selector", () => {
    const firstWindow = new Date("2026-08-21T12:00:00.000Z");
    const sameWindow = new Date("2026-08-21T23:59:59.999Z");
    const day31 = new Date("2026-09-21T12:00:00.000Z");
    const original = createWebsiteReviewSelector({ ...review, secret, now: firstWindow });
    const unchanged = createWebsiteReviewSelector({ ...review, secret, now: sameWindow });
    const renewed = createWebsiteReviewSelector({ ...review, secret, now: day31 });

    expect(unchanged).toBe(original);
    expect(renewed).not.toBe(original);
    expect(verifyWebsiteReviewSelector({
      ...review,
      selector: original,
      secret,
      now: day31,
    })).toBe(false);
    expect(verifyWebsiteReviewSelector({
      ...review,
      selector: renewed,
      secret,
      now: day31,
    })).toBe(true);
  });

  it("reconstructs only a canonical persisted selector window", () => {
    const issued = createWebsiteReviewSelectorRecord({
      ...review,
      secret,
      now: new Date("2026-08-21T12:00:00.000Z"),
    });

    expect(createWebsiteReviewSelectorRecordForExpiry({
      ...review,
      secret,
      expiresAt: issued.expiresAt,
    })).toEqual(issued);
    expect(() => createWebsiteReviewSelectorRecordForExpiry({
      ...review,
      secret,
      expiresAt: new Date(issued.expiresAt.getTime() - 1),
    })).toThrow("website_review_selector_input_invalid");
  });
});
