import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { CustomerReviewsSection } from "@/components/customer-reviews/customer-reviews-section";
import { SiteChrome } from "@/components/site-chrome";

const state = vi.hoisted(() => ({
  loadReviews: vi.fn(),
}));

vi.mock("@/domain/analytics/runtime", () => ({ isGa4Production: () => false }));
vi.mock("@/server/admin/admin-content-runtime", () => ({
  getSafePublicContent: async () => ({
    "footer.tagline": "Footer",
    "contact.email": "a@b.test",
    "contact.phone": "+64",
  }),
}));
vi.mock("@/server/auth/get-optional-session", () => ({
  getOptionalSession: async () => null,
}));
vi.mock("@/server/admin/product-registry-runtime", () => ({
  getSafePublicProductRegistry: async () => ({ registry: { markets: { AU: { enabled: true } } } }),
}));
vi.mock("@/server/customer-reviews/customer-review-runtime", () => ({
  getSafePublicCustomerReviewSection: state.loadReviews,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => ({ get: () => null }),
}));

import RootLayout from "./layout";

type ElementWithChildren = ReactElement<{ children?: ReactNode }>;

function childByType(parent: ElementWithChildren, type: unknown): ElementWithChildren | undefined {
  return Children.toArray(parent.props.children)
    .find((child): child is ElementWithChildren => isValidElement(child) && child.type === type);
}

describe("RootLayout shared customer reviews", () => {
  it("loads one safe public DTO and supplies the existing section to SiteChrome", async () => {
    const reviewSection = {
      summary: null,
      featured: {
        id: "11111111-1111-4111-8111-111111111111",
        reviewerName: "Shared reviewer",
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
    state.loadReviews.mockResolvedValueOnce(reviewSection);

    const html = await RootLayout({ children: <main>Page</main> });
    const body = childByType(html, "body");
    const chrome = body ? childByType(body, SiteChrome) : undefined;
    const footerLead = (chrome as ReactElement<{ footerLead?: ReactNode }> | undefined)
      ?.props.footerLead;

    expect(state.loadReviews).toHaveBeenCalledTimes(1);
    expect(isValidElement(footerLead)).toBe(true);
    expect((footerLead as ReactElement).type).toBe(CustomerReviewsSection);
    expect((footerLead as ReactElement<{ background: string; data: unknown }>).props)
      .toEqual({ background: "sand", data: reviewSection });
  });
});
