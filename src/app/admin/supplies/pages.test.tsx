import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SuppliesSchemaPendingError } from "@/server/supplies/errors";
import SuppliesPage from "./page";
import CategoriesPage from "./categories/page";
import ProductsPage from "./products/page";
import NewProductPage from "./products/new/page";
import EditProductPage from "./products/[productId]/page";
import SettingsPage from "./settings/page";

const { requireAdminPage, getCatalogue } = vi.hoisted(() => ({ requireAdminPage: vi.fn(), getCatalogue: vi.fn() }));
vi.mock("@/server/auth/require-admin-page", () => ({ requireAdminPage }));
vi.mock("@/server/supplies/catalogue", () => ({ getAdminSuppliesCatalogue: getCatalogue }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), notFound: () => { throw new Error("NOT_FOUND"); } }));

beforeEach(() => {
  requireAdminPage.mockReset().mockResolvedValue({ adminRole: "staff", adminPermissions: ["manage_content"] });
  getCatalogue.mockReset().mockResolvedValue({ settings: { enabled: false, updatedAt: null, updatedBy: null }, categories: [], products: [] });
});

describe("Supplies server admin pages", () => {
  it("provides both private previews while OFF without enabling purchases", async () => {
    render(await SuppliesPage());
    expect(requireAdminPage).toHaveBeenCalledWith("/admin/supplies", "manage_content");
    expect(screen.getByRole("link", { name: "Preview Store" })).toHaveAttribute("href", "/admin/supplies/preview");
    expect(screen.getByRole("link", { name: "Preview Draft Products" })).toHaveAttribute("href", "/admin/supplies/preview?drafts=1");
    expect(screen.getByText("Store OFF")).toBeInTheDocument();
  });

  it.each([
    ["categories", CategoriesPage], ["products", ProductsPage], ["products/new", NewProductPage], ["settings", SettingsPage],
  ] as const)("requires manage_content on %s", async (path, page) => {
    render(await page());
    expect(requireAdminPage).toHaveBeenCalledWith(`/admin/supplies/${path}`, "manage_content");
  });

  it("shows missing-schema readiness honestly and does not offer create or enable actions", async () => {
    getCatalogue.mockRejectedValue(new SuppliesSchemaPendingError());
    render(await SuppliesPage());
    expect(screen.getByRole("status")).toHaveTextContent("Database upgrade pending");
    expect(screen.queryByRole("link", { name: "New product" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Enable Supplies Store" })).not.toBeInTheDocument();
  });

  it("does not disguise operational errors as migration readiness", async () => {
    getCatalogue.mockRejectedValue(new Error("Connection unavailable"));
    await expect(ProductsPage()).rejects.toThrow("Connection unavailable");
  });

  it("protects edit routes and returns not found for an absent product", async () => {
    await expect(EditProductPage({ params: Promise.resolve({ productId: "missing-product" }) })).rejects.toThrow("NOT_FOUND");
    expect(requireAdminPage).toHaveBeenCalledWith("/admin/supplies/products/missing-product", "manage_content");
  });
});
