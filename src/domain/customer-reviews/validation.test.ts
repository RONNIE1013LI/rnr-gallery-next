import { describe, expect, it } from "vitest";

import {
  parseCustomerReviewMutation,
  parseFacebookReviewSummary,
  parseFacebookUrl,
} from "./validation";

const validReview = {
  reviewerName: "Litea M.",
  originalReviewText: "Amazing service.\nThe canvas was beautiful.",
  sourceReviewUrl: "https://www.facebook.com/RandRgallery/reviews/",
  reviewDate: "2026-08-20",
  recommendationStatus: "RECOMMENDS",
  editorialHeadline: "A meaningful family canvas",
  productKey: "digital-oil-painting-canvas",
  productDisplayLabel: "Digital Oil Painting Canvas",
  orderContext: "Custom family canvas",
  isHomepageFeatured: false,
  displayOrder: 0,
  permissionStatus: "GRANTED",
  permissionEvidenceReference: "Messenger confirmation retained privately",
  permissionNotes: "Customer approved website republication.",
  lastVerifiedAt: "2026-08-20T08:30:00.000Z",
} as const;

describe("customer review validation", () => {
  it("accepts only credential-free HTTPS Facebook URLs", () => {
    expect(parseFacebookUrl("https://www.facebook.com/RandRgallery/reviews/"))
      .toBe("https://www.facebook.com/RandRgallery/reviews/");
    expect(parseFacebookUrl("https://m.facebook.com/story.php?id=123"))
      .toBe("https://m.facebook.com/story.php?id=123");
    expect(() => parseFacebookUrl("https://facebook.com.evil.test/review"))
      .toThrow("Enter a valid Facebook URL");
    expect(() => parseFacebookUrl("javascript:alert(1)"))
      .toThrow("Enter a valid Facebook URL");
    expect(() => parseFacebookUrl("https://user:pass@facebook.com/review"))
      .toThrow("Enter a valid Facebook URL");
  });

  it("preserves source review line breaks while trimming only field edges", () => {
    expect(parseCustomerReviewMutation({
      ...validReview,
      originalReviewText: "  First line\n\nSecond line  ",
    }).originalReviewText).toBe("First line\n\nSecond line");
  });

  it("rejects missing names, invalid product pairs, and Featured without consent", () => {
    expect(() => parseCustomerReviewMutation({ ...validReview, reviewerName: " " }))
      .toThrow("Reviewer name is required");
    expect(() => parseCustomerReviewMutation({
      ...validReview,
      productDisplayLabel: null,
    })).toThrow("Choose a valid associated product");
    expect(() => parseCustomerReviewMutation({
      ...validReview,
      permissionStatus: "PENDING",
      isHomepageFeatured: true,
    })).toThrow("Permission must be granted before featuring a review");
  });

  it("normalizes empty optional fields to null and enforces bounded values", () => {
    expect(parseCustomerReviewMutation({
      ...validReview,
      sourceReviewUrl: "",
      editorialHeadline: " ",
      productKey: "",
      productDisplayLabel: "",
      orderContext: "",
      permissionEvidenceReference: "",
      permissionNotes: "",
      lastVerifiedAt: "",
    })).toMatchObject({
      sourceReviewUrl: null,
      editorialHeadline: null,
      productKey: null,
      productDisplayLabel: null,
      orderContext: null,
      permissionEvidenceReference: null,
      permissionNotes: null,
      lastVerifiedAt: null,
    });
    expect(() => parseCustomerReviewMutation({
      ...validReview,
      originalReviewText: "x".repeat(10_001),
    })).toThrow();
  });

  it("parses the manually verified Facebook summary", () => {
    expect(parseFacebookReviewSummary({
      facebookRating: "5.0",
      facebookRecommendationCount: "285",
      facebookCountIsApproximate: true,
      facebookReviewsPageUrl: "https://www.facebook.com/RandRgallery/reviews/",
      facebookLastVerifiedAt: "2026-08-20",
    })).toEqual({
      facebookRating: 5,
      facebookRecommendationCount: 285,
      facebookCountIsApproximate: true,
      facebookReviewsPageUrl: "https://www.facebook.com/RandRgallery/reviews/",
      facebookLastVerifiedAt: "2026-08-20",
    });
  });

  it("rejects impossible ratings, counts, and verification dates", () => {
    expect(() => parseFacebookReviewSummary({
      facebookRating: "5.1",
      facebookRecommendationCount: "285",
      facebookCountIsApproximate: false,
      facebookReviewsPageUrl: "https://www.facebook.com/RandRgallery/reviews/",
      facebookLastVerifiedAt: "2026-08-20",
    })).toThrow();
    expect(() => parseFacebookReviewSummary({
      facebookRating: "5",
      facebookRecommendationCount: "-1",
      facebookCountIsApproximate: false,
      facebookReviewsPageUrl: "https://www.facebook.com/RandRgallery/reviews/",
      facebookLastVerifiedAt: "not-a-date",
    })).toThrow();
  });
});
