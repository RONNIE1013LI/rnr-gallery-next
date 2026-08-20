import { describe, expect, it } from "vitest";

import {
  buildCustomerReviewMediaAuditRecord,
  mapPublicCustomerReview,
} from "./drizzle-customer-review-repository";

describe("customer review public database projection", () => {
  it("rebuilds an allowlisted public DTO without private permission or storage data", () => {
    const review = mapPublicCustomerReview({
      id: "00000000-0000-4000-8000-000000000001",
      reviewerName: "R&R customer",
      originalReviewText: "A beautiful canvas.",
      sourceReviewUrl: "https://www.facebook.com/RandRgallery/reviews/",
      reviewDate: "2026-08-10",
      editorialHeadline: "A meaningful keepsake",
      productKey: "digital-oil-painting-canvas",
      productDisplayLabel: "Digital Oil Painting Canvas",
      orderContext: "Custom family canvas",
      isHomepageFeatured: true,
    }, [{
      kind: "AVATAR",
      mimeType: "image/jpeg",
      width: 100,
      height: 100,
      storageKey: "private-uploads/secret.bin",
    }]);

    expect(review.avatar).toEqual({
      url: "/review-media/00000000-0000-4000-8000-000000000001/avatar",
      mimeType: "image/jpeg",
      width: 100,
      height: 100,
    });
    expect(review.featuredImage).toBeNull();
    expect(JSON.stringify(review)).not.toMatch(
      /storageKey|permission|evidence|createdBy|updatedBy/i,
    );
  });

  it("never exposes permission evidence as public media", () => {
    const review = mapPublicCustomerReview({
      id: "00000000-0000-4000-8000-000000000002",
      reviewerName: "Customer",
      originalReviewText: "Recommended.",
      sourceReviewUrl: null,
      reviewDate: "2026-08-11",
      editorialHeadline: null,
      productKey: null,
      productDisplayLabel: null,
      orderContext: null,
      isHomepageFeatured: false,
    }, [{
      kind: "PERMISSION_EVIDENCE",
      mimeType: "image/png",
      width: 200,
      height: 100,
      storageKey: "private-uploads/evidence.bin",
    }]);

    expect(review.avatar).toBeNull();
    expect(review.featuredImage).toBeNull();
  });

  it("builds a redacted media replacement audit record", () => {
    const record = buildCustomerReviewMediaAuditRecord({
      reviewId: "00000000-0000-4000-8000-000000000003",
      kind: "PERMISSION_EVIDENCE",
      replacedExisting: true,
      actor: {
        userId: "admin-1",
        email: "admin@example.test",
        idempotencyKey: "media-request-1",
        requestSource: "/api/admin/customer-reviews/review-1",
      },
    });

    expect(record).toMatchObject({
      action: "customer_review.media_replaced",
      resourceType: "customer_review",
      resourceId: "00000000-0000-4000-8000-000000000003",
      afterSummary: { mediaKind: "PERMISSION_EVIDENCE", replacedExisting: true },
    });
    expect(JSON.stringify(record)).not.toMatch(/storage|filename|url|image|permissionNotes/i);
  });
});
