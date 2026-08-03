import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AdminGalleryPage from "./page";

const { requireAdminPage, list } = vi.hoisted(() => ({ requireAdminPage: vi.fn(), list: vi.fn() }));
vi.mock("@/server/auth/require-admin-page", () => ({ requireAdminPage }));
vi.mock("@/server/gallery/admin-gallery-runtime", () => ({ getAdminGalleryService: () => ({ list }) }));

describe("admin gallery page", () => {
  it("requires an administrator and renders manageable designs", async () => {
    requireAdminPage.mockResolvedValue({ user: { id: "admin-1" } });
    list.mockResolvedValue([{ id: "a".repeat(64), altText: "Memorial canvas", productTypeSlug: "canvas", occasionSlug: "memorial", subOccasion: null, themeSlugs: [], productSlug: "digital-oil-painting-canvas", status: "active", imageUrl: `/gallery-images/${"a".repeat(64)}` }]);
    render(await AdminGalleryPage());
    expect(requireAdminPage).toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Design Gallery management" })).toBeInTheDocument();
    expect(screen.getByText("Memorial canvas")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add design" })).toHaveAttribute("href", "/admin/design-gallery/new");
    expect(screen.getByRole("link", { name: "Edit Memorial canvas" })).toHaveAttribute("href", `/admin/design-gallery/${"a".repeat(64)}`);
  });
});
