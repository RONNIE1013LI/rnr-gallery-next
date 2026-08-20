import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import EditCustomerReviewPage from "./page";

const { requireAdminPage, getAdmin, current } = vi.hoisted(() => ({ requireAdminPage: vi.fn(), getAdmin: vi.fn(), current: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), notFound: vi.fn() }));
vi.mock("@/server/auth/require-admin-page", () => ({ requireAdminPage }));
vi.mock("@/server/customer-reviews/customer-review-runtime", () => ({ getCustomerReviewRuntime: () => ({ getAdmin }) }));
vi.mock("@/server/admin/product-registry-runtime", () => ({ getProductRegistryRuntime: () => ({ current }) }));

describe("EditCustomerReviewPage", () => {
  it("loads private edit fields only after manage_reviews authorisation", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    requireAdminPage.mockResolvedValue({ user: { id: "admin-1" }, adminRole: "admin", adminPermissions: [] });
    current.mockResolvedValue({ registry: { products: [] } });
    getAdmin.mockResolvedValue({
      id, sourcePlatform: "FACEBOOK", status: "DRAFT", reviewerName: "Aroha", originalReviewText: "Recommended.", sourceReviewUrl: null,
      reviewDate: "2026-08-20", recommendationStatus: "RECOMMENDS", editorialHeadline: null, productKey: null, productDisplayLabel: null,
      orderContext: null, isHomepageFeatured: false, displayOrder: 0, permissionStatus: "PENDING", permissionEvidenceReference: "private-ref",
      permissionNotes: "private-note", lastVerifiedAt: null, publishedAt: null, archivedAt: null,
      createdAt: new Date("2026-08-20T00:00:00Z"), updatedAt: new Date("2026-08-20T00:00:00Z"), media: [],
    });

    render(await EditCustomerReviewPage({ params: Promise.resolve({ reviewId: id }) }));
    expect(requireAdminPage).toHaveBeenCalledWith(`/admin/customer-reviews/${id}`, "manage_reviews");
    expect(screen.getByDisplayValue("private-ref")).toBeInTheDocument();
    expect(screen.getByDisplayValue("private-note")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish review" })).toBeDisabled();
  });
});
