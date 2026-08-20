import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { defaultProductRegistry } from "@/domain/catalogue/product-registry";
import Home from "./page";

const state = vi.hoisted(() => ({ reviews: null as unknown, registry: null as unknown }));
vi.mock("@/server/admin/product-registry-runtime", () => ({
  getSafePublicProductRegistry: async () => ({ registry: state.registry }),
}));
vi.mock("@/server/gallery/gallery-runtime", () => ({
  getGalleryRuntime: () => ({ publicService: { findByIds: async () => [] } }),
}));
vi.mock("@/server/customer-reviews/customer-review-runtime", () => ({
  getSafePublicCustomerReviewSection: async () => state.reviews,
}));

describe("Homepage route review data", () => {
  it("passes the safe public customer review DTO to Homepage V3", async () => {
    state.registry = defaultProductRegistry;
    state.reviews = {
      summary: null,
      featured: {
        id: "11111111-1111-4111-8111-111111111111",
        reviewerName: "Shared NZ reviewer",
        originalReviewText: "Approved public wording.",
        sourceReviewUrl: null,
        reviewDate: "2026-08-20",
        recommendationStatus: "RECOMMENDS",
        editorialHeadline: null,
        productKey: null,
        productDisplayLabel: null,
        orderContext: null,
        isHomepageFeatured: true,
        avatar: null,
        featuredImage: null,
      },
      reviews: [],
    };

    render(await Home());
    expect(screen.getByText("Shared NZ reviewer")).toBeInTheDocument();
  });
});
