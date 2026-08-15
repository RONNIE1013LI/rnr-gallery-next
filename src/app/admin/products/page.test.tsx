import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AdminProductsPage from "./page";
import { defaultProductRegistry } from "@/domain/catalogue/product-registry";

const { requireAdminPage, current } = vi.hoisted(() => ({
  requireAdminPage: vi.fn(),
  current: vi.fn(),
}));
vi.mock("@/server/auth/require-admin-page", () => ({ requireAdminPage }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/server/admin/product-registry-runtime", () => ({
  getProductRegistryRuntime: () => ({ current }),
}));

describe("admin products page", () => {
  it("shows the authoritative registry with protected publication controls", async () => {
    requireAdminPage.mockResolvedValue({ user: { id: "admin-1" }, adminRole: "admin" });
    current.mockResolvedValue({ revision: 2, registry: defaultProductRegistry });
    render(await AdminProductsPage());

    expect(requireAdminPage).toHaveBeenCalledWith("/admin/products", "manage_prices");
    expect(screen.getByRole("heading", { name: "Products & pricing" })).toBeInTheDocument();
    expect(screen.getAllByText("Digital Oil Painting Canvas")).toHaveLength(2);
    expect(within(screen.getByRole("note")).getByText(/revision 2/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish Digital Oil Painting Canvas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish store-wide fees" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Australia — AUD" })).toBeInTheDocument();
    expect(screen.getByText(/AUD prices still required/i)).toBeInTheDocument();
    expect(screen.queryByText(/editing is locked/i)).not.toBeInTheDocument();
  });
});
