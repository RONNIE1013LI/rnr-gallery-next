import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import NewCustomerReviewPage from "./page";

const { requireAdminPage, current } = vi.hoisted(() => ({ requireAdminPage: vi.fn(), current: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/server/auth/require-admin-page", () => ({ requireAdminPage }));
vi.mock("@/server/admin/product-registry-runtime", () => ({ getProductRegistryRuntime: () => ({ current }) }));

describe("NewCustomerReviewPage", () => {
  it("requires manage_reviews and honours the independent publisher grant", async () => {
    requireAdminPage.mockResolvedValue({ user: { id: "staff-1" }, adminRole: "staff", adminPermissions: ["manage_reviews"] });
    current.mockResolvedValue({ registry: { products: [{ key: "canvas", title: "Canvas", active: true }] } });
    render(await NewCustomerReviewPage());

    expect(requireAdminPage).toHaveBeenCalledWith("/admin/customer-reviews/new", "manage_reviews");
    expect(screen.getByRole("heading", { name: "New customer review" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish review" })).not.toBeInTheDocument();
  });
});
