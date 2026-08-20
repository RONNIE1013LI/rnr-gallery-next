import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AdminCustomerReviewsPage from "./page";

const { requireAdminPage, listAdmin, getSettings } = vi.hoisted(() => ({
  requireAdminPage: vi.fn(),
  listAdmin: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("@/server/auth/require-admin-page", () => ({ requireAdminPage }));
vi.mock("@/server/customer-reviews/customer-review-runtime", () => ({
  getCustomerReviewRuntime: () => ({ listAdmin, getSettings }),
}));

describe("AdminCustomerReviewsPage", () => {
  it("requires manage_reviews and exposes publishing only to publish_reviews", async () => {
    requireAdminPage.mockResolvedValue({
      user: { id: "staff-1" },
      adminRole: "staff",
      adminPermissions: ["access_admin", "manage_reviews"],
    });
    listAdmin.mockResolvedValue([]);
    getSettings.mockResolvedValue({ draft: null, published: null });

    render(await AdminCustomerReviewsPage());

    expect(requireAdminPage).toHaveBeenCalledWith("/admin/customer-reviews", "manage_reviews");
    expect(screen.getByRole("heading", { name: "Customer reviews" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New review" })).toHaveAttribute(
      "href",
      "/admin/customer-reviews/new",
    );
    expect(screen.queryByRole("button", { name: "Publish summary" })).not.toBeInTheDocument();
  });
});
