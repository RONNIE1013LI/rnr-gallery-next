import { describe, expect, it, vi } from "vitest";

import type { PublicCustomerReview } from "@/domain/customer-reviews/types";
import { createCustomerReviewService } from "./customer-review-service";

const actor = {
  userId: "admin-1",
  email: "admin@example.test",
  idempotencyKey: "review-action-123",
};

const mutation = {
  sourcePlatform: "FACEBOOK" as const,
  reviewerName: "R&R customer",
  originalReviewText: "Wonderful service and a beautiful result.",
  sourceReviewUrl: "https://www.facebook.com/RandRgallery/reviews/",
  reviewDate: "2026-08-10",
  recommendationStatus: "RECOMMENDS" as const,
  editorialHeadline: "A meaningful result",
  productKey: "digital-oil-painting-canvas",
  productDisplayLabel: "Digital Oil Painting Canvas",
  orderContext: "Custom family canvas",
  isHomepageFeatured: true,
  displayOrder: 1,
  permissionStatus: "GRANTED" as const,
  permissionEvidenceReference: "Private evidence reference",
  permissionNotes: "Private permission note",
  lastVerifiedAt: "2026-08-20T00:00:00.000Z",
};

const publicReview = (id: string, featured = false): PublicCustomerReview => ({
  id,
  sourcePlatform: "FACEBOOK",
  reviewerName: `Customer ${id}`,
  originalReviewText: `Review ${id}`,
  sourceReviewUrl: "https://www.facebook.com/RandRgallery/reviews/",
  reviewDate: "2026-08-10",
  recommendationStatus: "RECOMMENDS",
  editorialHeadline: null,
  productKey: null,
  productDisplayLabel: null,
  orderContext: null,
  isHomepageFeatured: featured,
  avatar: null,
  featuredImage: null,
});

function repository(overrides: Record<string, unknown> = {}) {
  return {
    listAdmin: vi.fn().mockResolvedValue([]),
    findAdmin: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: "review-1" }),
    update: vi.fn().mockResolvedValue({ id: "review-1" }),
    archive: vi.fn().mockResolvedValue({ id: "review-1", status: "ARCHIVED" }),
    listPublic: vi.fn().mockResolvedValue([]),
    getSettings: vi.fn().mockResolvedValue({ draft: null, published: null }),
    saveSettings: vi.fn().mockResolvedValue({ draft: null, published: null }),
    ...overrides,
  };
}

describe("customer review service", () => {
  it("rejects publication without granted permission", async () => {
    const repo = repository();
    const service = createCustomerReviewService({
      repository: repo,
      isKnownProductKey: () => true,
    });

    await expect(service.create({
      ...mutation,
      permissionStatus: "PENDING",
      isHomepageFeatured: false,
    }, actor, { publish: true })).rejects.toThrow(
      "Permission must be granted before publishing",
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("rejects a stale or invented product key", async () => {
    const repo = repository();
    const service = createCustomerReviewService({
      repository: repo,
      isKnownProductKey: () => false,
    });

    await expect(service.create(mutation, actor, { publish: false }))
      .rejects.toThrow("Choose a valid associated product");
  });

  it("publishes only with server-owned status timestamps", async () => {
    const repo = repository();
    const now = new Date("2026-08-20T09:00:00.000Z");
    const service = createCustomerReviewService({
      repository: repo,
      isKnownProductKey: () => true,
      now: () => now,
    });

    await service.create(mutation, actor, { publish: true });

    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({
      status: "PUBLISHED",
      publishedAt: now,
      archivedAt: null,
    }), actor);
  });

  it("returns null with no eligible public recommendation", async () => {
    const service = createCustomerReviewService({
      repository: repository(),
      isKnownProductKey: () => true,
    });

    await expect(service.getSafePublicSection()).resolves.toBeNull();
  });

  it("selects the explicit Featured review once and preserves public-only DTOs", async () => {
    const reviews = [publicReview("ordered-first"), publicReview("featured", true), publicReview("last")];
    const service = createCustomerReviewService({
      repository: repository({
        listPublic: vi.fn().mockResolvedValue(reviews),
        getSettings: vi.fn().mockResolvedValue({
          draft: null,
          published: {
            facebookRating: 5,
            facebookRecommendationCount: 285,
            facebookCountIsApproximate: true,
            facebookReviewsPageUrl: "https://www.facebook.com/RandRgallery/reviews/",
            facebookLastVerifiedAt: "2026-08-20",
          },
        }),
      }),
      isKnownProductKey: () => true,
    });

    const section = await service.getSafePublicSection();
    expect(section?.featured.id).toBe("featured");
    expect(section?.reviews.map((review) => review.id)).toEqual(["ordered-first", "last"]);
    expect(JSON.stringify(section)).not.toMatch(/permission|storageKey|createdBy/i);
    expect(section?.summary).toEqual({
      rating: 5,
      recommendationCount: 285,
      countIsApproximate: true,
      reviewsPageUrl: "https://www.facebook.com/RandRgallery/reviews/",
      lastVerifiedAt: "2026-08-20",
    });
  });

  it("uses deterministic public order as the Featured fallback", async () => {
    const service = createCustomerReviewService({
      repository: repository({
        listPublic: vi.fn().mockResolvedValue([
          publicReview("display-order-first"),
          publicReview("second"),
        ]),
      }),
      isKnownProductKey: () => true,
    });

    const section = await service.getSafePublicSection();
    expect(section?.featured.id).toBe("display-order-first");
    expect(section?.reviews.map((review) => review.id)).toEqual(["second"]);
  });
});
