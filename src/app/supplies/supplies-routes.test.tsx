import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ catalogue: vi.fn(), adminCatalogue: vi.fn(), permission: vi.fn() }));
vi.mock("@/server/supplies/catalogue", () => ({ getPublicSuppliesCatalogue: state.catalogue, getAdminSuppliesCatalogue: state.adminCatalogue }));
vi.mock("@/server/auth/require-admin-page", () => ({ requireAdminPage: state.permission }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/components/supplies-storefront", () => ({
  SuppliesStorefront: ({ preview, includeDrafts }: { preview?: boolean; includeDrafts?: boolean }) => <div>{preview ? "Admin Preview" : "Public Store"}{includeDrafts ? " with drafts" : ""}</div>,
  SupplyProductDetail: () => <div>Product detail</div>,
}));

import SuppliesPage, { generateMetadata } from "./page";
import PreviewPage from "../admin/supplies/preview/page";
import PreviewLayout from "../admin/supplies/preview/layout";

beforeEach(() => {
  state.catalogue.mockReset().mockResolvedValue(null);
  state.adminCatalogue.mockReset().mockResolvedValue({ settings: { enabled: false }, categories: [], products: [] });
  state.permission.mockReset().mockResolvedValue({ user: { id: "admin" } });
});

describe("Supplies public and private routes", () => {
  it("returns not found when OFF even if a visitor supplies preview parameters", async () => {
    await expect(SuppliesPage()).rejects.toThrow("NOT_FOUND");
    expect(await generateMetadata()).toMatchObject({ robots: { index: false, follow: false } });
  });

  it("requires server admin access for OFF preview including drafts", async () => {
    render(await PreviewPage({ searchParams: Promise.resolve({ drafts: "1" }) }));
    expect(state.permission).toHaveBeenCalledWith("/admin/supplies/preview", "manage_content");
    expect(state.adminCatalogue).toHaveBeenCalledWith(true);
    expect(screen.getByText("Admin Preview with drafts")).toBeInTheDocument();
  });

  it("refuses private preview before reading catalogue if authorization fails", async () => {
    state.permission.mockRejectedValue(new Error("Forbidden"));
    await expect(PreviewPage({ searchParams: Promise.resolve({ drafts: "1" }) })).rejects.toThrow("Forbidden");
    expect(state.adminCatalogue).not.toHaveBeenCalled();
  });

  it("shows the non-public banner through the authenticated preview layout", async () => {
    render(await PreviewLayout({ children: <div>Preview content</div> }));
    expect(screen.getByText("Preview Mode — Not Public")).toBeInTheDocument();
  });
});
